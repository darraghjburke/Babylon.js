import * as React from "react";
import { DragOverLocation, GlobalState } from "../globalState";
import { Nullable } from "babylonjs/types";
import { Control } from "babylonjs-gui/2D/controls/control";
import { AdvancedDynamicTexture } from "babylonjs-gui/2D/advancedDynamicTexture";
import { Vector2, Vector3 } from "babylonjs/Maths/math.vector";
import { Engine } from "babylonjs/Engines/engine";
import { Scene } from "babylonjs/scene";
import { Color4 } from "babylonjs/Maths/math.color";
import { ArcRotateCamera } from "babylonjs/Cameras/arcRotateCamera";
import { HemisphericLight } from "babylonjs/Lights/hemisphericLight";
import { Axis } from "babylonjs/Maths/math.axis";
import { Epsilon } from "babylonjs/Maths/math.constants";
import { Container } from "babylonjs-gui/2D/controls/container";
import { KeyboardEventTypes, KeyboardInfo } from "babylonjs/Events/keyboardEvents";
import { Line } from "babylonjs-gui/2D/controls/line";
import { DataStorage } from "babylonjs/Misc/dataStorage";
import { Grid } from "babylonjs-gui/2D/controls/grid";
import { Tools } from "../tools";
import { Observer } from "babylonjs/Misc/observable";
import { ISize } from "babylonjs/Maths/math";
import { Texture } from "babylonjs/Materials/Textures/texture";
import { CoordinateHelper } from "./coordinateHelper";
import { Logger } from "babylonjs/Misc/logger";
require("./workbenchCanvas.scss");

export interface IWorkbenchComponentProps {
    globalState: GlobalState;
}

export enum ConstraintDirection {
    NONE = 0,
    X = 2, // Horizontal constraint
    Y = 3, // Vertical constraint
}

const ARROW_KEY_MOVEMENT_SMALL = 1; // px
const ARROW_KEY_MOVEMENT_LARGE = 5; // px

const MAX_POINTER_TRAVEL_DISTANCE = 5; //px^2. determines how far the pointer can move to be treated as a drag vs. a click

export class WorkbenchComponent extends React.Component<IWorkbenchComponentProps> {
    private _rootContainer: React.RefObject<HTMLCanvasElement>;
    private _setConstraintDirection: boolean = false;
    private _mouseStartPoint: Nullable<Vector2> = null;
    public _scene: Scene;
    private _ctrlKeyIsPressed = false;
    private _altKeyIsPressed = false;
    private _constraintDirection = ConstraintDirection.NONE;
    private _forcePanning = false;
    private _forceZooming = false;
    private _forceSelecting = true;
    private _panning: boolean;
    private _canvas: HTMLCanvasElement;
    private _responsive: boolean;
    private _isOverGUINode: Control[] = [];
    private _engine: Engine;
    private _liveRenderObserver: Nullable<Observer<AdvancedDynamicTexture>>;
    private _guiRenderObserver: Nullable<Observer<AdvancedDynamicTexture>>;
    private _doubleClick: Nullable<Control> = null;
    public _liveGuiTextureRerender: boolean = true;
    private _controlsHit: Control[] = [];
    private _pointerTravelDistance = 0;
    private _processSelectionOnUp = false;
    private _visibleRegionContainer: Container;
    public get visibleRegionContainer() {
        return this._visibleRegionContainer;
    }
    private _panAndZoomContainer: Container;
    public get panAndZoomContainer() {
        return this._panAndZoomContainer;
    }
    private _trueRootContainer: Container;
    public set trueRootContainer(value: Container) {
        if (value === this._trueRootContainer) return;
        this._visibleRegionContainer.children.forEach(child => this._visibleRegionContainer.removeControl(child));
        this._visibleRegionContainer.addControl(value);
        this._trueRootContainer = value;
        value._host = this.globalState.guiTexture;
    }
    public get trueRootContainer() {
        return this._trueRootContainer;
    }
    private _nextLiveGuiRender = -1;
    private _liveGuiRerenderDelay = 30;
    private _defaultGUISize: ISize = { width: 1024, height: 1024 };
    private _initialPanningOffset: Vector2 = new Vector2(0, 0);
    private _panningOffset = new Vector2(0, 0);
    private _zoomFactor = 1;
    private _zoomModeIncrement = 0.2;
    private _guiSize = this._defaultGUISize;

    public get guiSize() {
        return this._guiSize;
    }
    // sets the size of the GUI and makes all neccessary adjustments
    public set guiSize(value: ISize) {
        this._guiSize = { ...value };
        this._visibleRegionContainer.widthInPixels = this._guiSize.width;
        this._visibleRegionContainer.heightInPixels = this._guiSize.height;
        this.globalState.onResizeObservable.notifyObservers(this._guiSize);
        this.globalState.onFitToWindowObservable.notifyObservers();
        this.globalState.onArtBoardUpdateRequiredObservable.notifyObservers();
    }

    public applyEditorTransformation() {
        const adt = this.globalState.guiTexture;
        if (adt._rootContainer != this._panAndZoomContainer) {
            adt._rootContainer = this._panAndZoomContainer;
            this._visibleRegionContainer.addControl(this._trueRootContainer);
            this.globalState.guiTexture.markAsDirty();
        }
        if (adt.getSize().width !== this._engine.getRenderWidth() || adt.getSize().height !== this._engine.getRenderHeight()) {
            adt.scaleTo(this._engine.getRenderWidth(), this._engine.getRenderHeight());
        }
        if (adt.getSize().width !== this._engine.getRenderWidth() || adt.getSize().height !== this._engine.getRenderHeight()) {
            adt.scaleTo(this._engine.getRenderWidth(), this._engine.getRenderHeight());
        }
        this._trueRootContainer.clipContent = false;
        this._trueRootContainer.clipChildren = false;
    }

    public removeEditorTransformation() {
        const adt = this.globalState.guiTexture;
        if (adt._rootContainer != this._trueRootContainer) {
            this._visibleRegionContainer.removeControl(this._trueRootContainer);
            adt._rootContainer = this._trueRootContainer;
        }
        this._trueRootContainer.clipContent = true;
        this._trueRootContainer.clipChildren = true;
    }

    private get globalState() {
        return this.props.globalState;
    }


    constructor(props: IWorkbenchComponentProps) {
        super(props);
        const { globalState } = props;
        this._rootContainer = React.createRef();
        this._responsive = DataStorage.ReadBoolean("Responsive", true);

        globalState.onSelectionChangedObservable.add(() => this.updateNodeOutlines());

        globalState.onPanObservable.add(() => {
            this._forcePanning = !this._forcePanning;
            this._forceSelecting = false;
            this._forceZooming = false;
            if (!this._forcePanning) {
                this.globalState.onSelectionButtonObservable.notifyObservers();
            } else {
                this._canvas.style.cursor = "grab";
            }
        });


        globalState.onSelectionButtonObservable.add(() => {
            this._forceSelecting = !this._forceSelecting;
            this._forcePanning = false;
            this._forceZooming = false;
            this._canvas.style.cursor = "default";
        });

        globalState.onZoomObservable.add(() => {
            this._forceZooming = !this._forceZooming;
            this._forcePanning = false;
            this._forceSelecting = false;
            if (!this._forceZooming) {
                this.globalState.onSelectionButtonObservable.notifyObservers();
            } else {
                this._canvas.style.cursor = "zoom-in";
            }
        });

        globalState.onFitToWindowObservable.add(() => {
            this._panningOffset = new Vector2(0, 0);
            const xFactor = this._engine.getRenderWidth() / this.guiSize.width;
            const yFactor = this._engine.getRenderHeight() / this.guiSize.height;
            this._zoomFactor = Math.min(xFactor, yFactor) * 0.9;
        });

        globalState.onOutlineChangedObservable.add(() => {
            this.updateNodeOutlines();
        });

        globalState.onSelectionChangedObservable.add(() => {
            this.updateNodeOutlines();
        });

        globalState.onParentingChangeObservable.add((control) => {
            this.parent(control);
        });

        globalState.onResponsiveChangeObservable.add((value) => {
            this._responsive = value;
        });

        globalState.hostDocument!.addEventListener("keyup", this.keyEvent, false);

        // Hotkey shortcuts
        globalState.hostDocument!.addEventListener("keydown", this.keyEvent, false);
        globalState.hostDocument!.defaultView!.addEventListener("blur", this.blurEvent, false);

        globalState.onWindowResizeObservable.add(() => {
            globalState.onGizmoUpdateRequireObservable.notifyObservers();
            globalState.onArtBoardUpdateRequiredObservable.notifyObservers();
            this._engine.resize();
        });

        globalState.onCopyObservable.add(copyFn => this.copyToClipboard(copyFn));
        globalState.onCutObservable.add(copyFn => this.cutToClipboard(copyFn));
        globalState.onPasteObservable.add(content => this.pasteFromClipboard(content));

        globalState.workbench = this;
        globalState.onResizeObservable.notifyObservers(this._guiSize);
    }

    keyEvent = (evt: KeyboardEvent) => {
        if ((evt.target as HTMLElement).localName === "input") return;
        this._ctrlKeyIsPressed = evt.ctrlKey;
        this._altKeyIsPressed = evt.altKey;
        if (evt.shiftKey) {
            this._setConstraintDirection = this._constraintDirection === ConstraintDirection.NONE;
        } else {
            this._setConstraintDirection = false;
            this._constraintDirection = ConstraintDirection.NONE;
        }

        if (evt.key === "Delete" || evt.key === "Backspace") {
            if (!this.globalState.lockObject.lock) {
                this._deleteSelectedNodes();
            }
        }

        if (this._ctrlKeyIsPressed && !this.globalState.lockObject.lock) {
            if (evt.key === "a") {
                this.globalState.setSelection(this.trueRootContainer.children);
            }
        }

        if (this._forceZooming) {
            this._canvas.style.cursor = this._altKeyIsPressed ? "zoom-out" : "zoom-in";
        }
    };

    private _deleteSelectedNodes() {
        for (const control of this.globalState.selectedControls) {
            this.globalState.guiTexture.removeControl(control);
            this.globalState.liveGuiTexture?.removeControl(control);
            control.dispose();
        };
        this.globalState.setSelection([]);
    }

    public copyToClipboard(copyFn: (content: string) => void) {
        const controlList: any[] = [];
        for (const control of this.globalState.selectedControls) {
            const obj = {}
            control.serialize(obj);
            controlList.push(obj);
        }
        copyFn(JSON.stringify({
            GUIClipboard: true,
            controls: controlList
        }));
    }

    public cutToClipboard(copyFn: (content: string) => void) {
        this.copyToClipboard(copyFn);
        this._deleteSelectedNodes();
    }

    public pasteFromClipboard(clipboardContents: string) {
        try {
            const parsed = JSON.parse(clipboardContents);
            if (parsed.GUIClipboard) {
                const newSelection = [];
                for (const control of parsed.controls) {
                    newSelection.push(this.appendBlock(Control.Parse(control, this.globalState.guiTexture)));
                }
                this.globalState.setSelection(newSelection);
                return true;
            }
        }
        catch {
            // don't need an error message
        }
        Logger.Warn("Paste attempted, but clipboard content was invalid.");
        return false;
    }

    public CopyGUIControl(original: Control) {
        const serializationObject = {};
        original.serialize(serializationObject);
        const newControl = Control.Parse(serializationObject, this.globalState.guiTexture);

        if (newControl) {
            //insert the new control into the adt or parent container
            this.globalState.workbench.appendBlock(newControl);
            this.globalState.guiTexture.removeControl(newControl);
            if (original.parent?.typeName === "Grid") {
                const cell = Tools.getCellInfo(original.parent as Grid, original);
                (original.parent as Grid).addControl(newControl, cell.x, cell.y);
            } else {
                original.parent?.addControl(newControl);
            }
            let index = 1;
            while (
                this.globalState.guiTexture.getDescendants(false).filter(
                    //search if there are any copies
                    (control) => control.name === `${newControl.name} Copy ${index}`
                ).length
            ) {
                index++;
            }
            newControl.name = `${newControl.name} Copy ${index}`;
            this.globalState.select(newControl);
        }
    }

    private selectAllGUI(node: Control) {
        this.globalState.select(node);
        if (node instanceof Container) {
            (node as Container).children.forEach((child) => {
                this.selectAllGUI(child);
            });
        }
    }

    blurEvent = () => {
        this._ctrlKeyIsPressed = false;
        this._constraintDirection = ConstraintDirection.NONE;
        this.globalState.onPointerUpObservable.notifyObservers(null);
    };

    componentWillUnmount() {
        this.globalState.hostDocument!.removeEventListener("keyup", this.keyEvent);
        this.globalState.hostDocument!.removeEventListener("keydown", this.keyEvent);
        this.globalState.hostDocument!.defaultView!.removeEventListener("blur", this.blurEvent);
        if (this.globalState.liveGuiTexture) {
            this.globalState.liveGuiTexture.onEndRenderObservable.remove(this._liveRenderObserver);
            this.globalState.guiTexture.onBeginRenderObservable.remove(this._guiRenderObserver);
            this.globalState.guiTexture.getDescendants(false).forEach(control => {
                if (!control.metadata || !control.metadata.guiEditor) {
                    return;
                }
                control.onPointerUpObservable.remove(control.metadata.onPointerUp);
                control.onPointerDownObservable.remove(control.metadata.onPointerDown);
                control.onPointerEnterObservable.remove(control.metadata.onPointerEnter);
                control.onPointerOutObservable.remove(control.metadata.onPointerOut);
                control.onDisposeObservable.remove(control.metadata.onDispose);
                control.highlightLineWidth = control.metadata.highlightLineWidth;
                control.isHighlighted = control.metadata.isHighlighted;
                control.isPointerBlocker = control.metadata.isPointerBlocker;
                control.metadata = control.metadata.metadata;
            })

        }
        this._engine.dispose();
    }

    loadFromJson(serializationObject: any) {
        this.removeEditorTransformation();
        this.globalState.setSelection([]);
        if (this.globalState.liveGuiTexture) {
            this.globalState.liveGuiTexture?.parseContent(serializationObject, true);
            this.synchronizeLiveGUI();
        } else {
            this.globalState.guiTexture.parseContent(serializationObject, true);
        }
        this.trueRootContainer = this.globalState.guiTexture._rootContainer;
        this.guiSize = this.globalState.guiTexture.getSize();
        this.loadToEditor();
    }

    async loadFromSnippet(snippetId: string) {
        this.removeEditorTransformation();
        this.globalState.setSelection([]);
        if (this.globalState.liveGuiTexture) {
            await this.globalState.liveGuiTexture?.parseFromSnippetAsync(snippetId, true);
            this.synchronizeLiveGUI();
        } else {
            await this.globalState.guiTexture.parseFromSnippetAsync(snippetId, true);
        }
        this.trueRootContainer = this.globalState.guiTexture._rootContainer;
        this.guiSize = this.globalState.guiTexture.getSize();
        this.loadToEditor();
        if (this.globalState.customLoad) {
            this.globalState.customLoad.action(this.globalState.guiTexture.snippetId).catch((err) => {
                alert("Unable to load your GUI");
            });
        }
    }

    loadToEditor() {
        this.globalState.guiTexture.rootContainer.children.forEach((guiElement) => {
            this.createNewGuiNode(guiElement);
        });

        this._isOverGUINode = [];
        this.globalState.setSelection([]);
        this.globalState.onFitToWindowObservable.notifyObservers();
    }

    public updateNodeOutlines() {
        for (const guiControl of this._trueRootContainer.getDescendants()) {
            guiControl.isHighlighted = guiControl.getClassName() === "Grid" && (this.globalState.outlines || this.globalState.selectedControls.includes(guiControl));
            guiControl.highlightLineWidth = 5;
        }
    }

    appendBlock(guiElement: Control) {
        if (this.globalState.liveGuiTexture) {
            this.globalState.liveGuiTexture.addControl(guiElement);
        }
        var newGuiNode = this.createNewGuiNode(guiElement);
        this.trueRootContainer.addControl(guiElement);
        return newGuiNode;
    }

    createNewGuiNode(guiControl: Control) {
        const onPointerUp = guiControl.onPointerUpObservable.add((evt) => {
            this.clicked = false;
        });

        const onPointerDown = guiControl.onPointerDownObservable.add((evt) => {
            if (evt.buttonIndex > 0 || !this._forceSelecting) return;
            this._controlsHit.push(guiControl);
        });

        const onPointerEnter = guiControl.onPointerEnterObservable.add((evt) => {
            if (this._isOverGUINode.indexOf(guiControl) === -1) {
                this._isOverGUINode.push(guiControl);
            }
        });

        const onPointerOut = guiControl.onPointerOutObservable.add((evt) => {
            const index = this._isOverGUINode.indexOf(guiControl);
            if (index !== -1) {
                this._isOverGUINode.splice(index, 1);
            }
        });

        const onDispose = guiControl.onDisposeObservable.add((evt) => {
            const index = this._isOverGUINode.indexOf(guiControl);
            if (index !== -1) {
                this._isOverGUINode.splice(index, 1);
            }
        });
        // use metadata to keep track of things we need to cleanup/restore when the gui editor closes
        // also stores the old metadata
        guiControl.metadata = {
            guiEditor: true,
            metadata: guiControl.metadata,
            isHighlighted: guiControl.isHighlighted,
            highlightLineWidth: guiControl.highlightLineWidth,
            isReadOnly: guiControl.isReadOnly,
            isHitTestVisible: guiControl.isHitTestVisible,
            isPointerBlocker: guiControl.isPointerBlocker,
            onPointerUp,
            onPointerDown,
            onPointerEnter,
            onPointerOut,
            onDispose
        }
        guiControl.highlightLineWidth = 5;
        guiControl.isHighlighted = false;
        guiControl.isReadOnly = true;
        guiControl.isHitTestVisible = true;
        guiControl.isPointerBlocker = true;
        guiControl.getDescendants(true).forEach((child) => {
            this.createNewGuiNode(child);
        });
        return guiControl;
    }

    private parent(dropLocationControl: Nullable<Control>) {
        const draggedControl = this.globalState.draggedControl;
        const draggedControlParent = draggedControl?.parent;

        if (draggedControlParent && draggedControl) {
            if (this._isNotChildInsert(dropLocationControl, draggedControl)) {
                //checking to make sure the element is not being inserted into a child

                if (dropLocationControl != null) {
                    //the control you are dragging onto top
                    if (
                        dropLocationControl instanceof Container && //dropping inside a contrainer control
                        this.globalState.draggedControlDirection === DragOverLocation.CENTER
                    ) {
                        draggedControlParent.removeControl(draggedControl);
                        (dropLocationControl as Container).addControl(draggedControl);
                        const stackPanel = dropLocationControl.typeName === "StackPanel" || dropLocationControl.typeName === "VirtualKeyboard";
                        if (stackPanel) {
                            this._convertToPixels(draggedControl, dropLocationControl as Container);
                        }
                    } else if (dropLocationControl.parent) {
                        //dropping inside the controls parent container
                        if (dropLocationControl.parent.typeName !== "Grid") {
                            draggedControlParent.removeControl(draggedControl);
                            let index = dropLocationControl.parent.children.indexOf(dropLocationControl);
                            const reversed = dropLocationControl.parent.typeName === "StackPanel" || dropLocationControl.parent.typeName === "VirtualKeyboard";

                            index = this._adjustParentingIndex(index, reversed); //adjusting index to be before or after based on where the control is over

                            dropLocationControl.parent.children.splice(index, 0, draggedControl);
                            draggedControl.parent = dropLocationControl.parent;
                            if (reversed) {
                                this._convertToPixels(draggedControl, draggedControl.parent);
                            }
                        } else if (dropLocationControl.parent === draggedControlParent) {
                            //special case for grid
                            this._reorderGrid(dropLocationControl.parent as Grid, draggedControl, dropLocationControl);
                        } else {
                            draggedControlParent.removeControl(draggedControl);
                            (dropLocationControl.parent as Container).addControl(draggedControl);
                            this._reorderGrid(dropLocationControl.parent as Grid, draggedControl, dropLocationControl);
                        }
                    } else {
                        draggedControlParent.removeControl(draggedControl);
                        this.trueRootContainer.addControl(draggedControl);
                    }
                } else {
                    draggedControlParent.removeControl(draggedControl);
                    this.trueRootContainer.addControl(draggedControl);
                    this.trueRootContainer.children.pop();
                    this.trueRootContainer.children.splice(0, 0, draggedControl);
                }
            }
        }
        this.globalState.draggedControl = null;
        this.globalState.onPropertyGridUpdateRequiredObservable.notifyObservers();
    }

    private _convertToPixels(draggedControl: Control, parent: Container) {
        const width = draggedControl.widthInPixels + "px";
        const height = draggedControl.heightInPixels + "px";
        if (draggedControl.width !== width || draggedControl.height !== height) {
            draggedControl.width = width;
            draggedControl.height = height;
            this.globalState.hostWindow.alert("Warning: Parenting to stack panel will convert control to pixel value");
        }
    }

    private _reorderGrid(grid: Grid, draggedControl: Control, dropLocationControl: Control) {
        const cellInfo = Tools.getCellInfo(grid, draggedControl);
        grid.removeControl(draggedControl);

        let index = grid.children.indexOf(dropLocationControl);
        index = this._adjustParentingIndex(index);

        Tools.reorderGrid(grid, index, draggedControl, cellInfo);
    }

    private _isNotChildInsert(control: Nullable<Control>, draggedControl: Nullable<Control>) {
        while (control?.parent) {
            if (control.parent == draggedControl) {
                return false;
            }
            control = control.parent;
        }
        return true;
    }

    private _adjustParentingIndex(index: number, reversed: boolean = false) {
        switch (this.globalState.draggedControlDirection) {
            case DragOverLocation.ABOVE:
                return reversed ? index : index + 1;
            case DragOverLocation.BELOW:
            case DragOverLocation.CENTER:
                return reversed ? index + 1 : index;
        }
        return index;
    }

    public isSelected(value: boolean, guiNode: Control) {
        this.globalState.select(guiNode);
    }

    public clicked: boolean;

    public _onMove(guiControl: Control, evt: Vector2, startPos: Vector2, ignorClick: boolean = false) {
        let newX = evt.x - startPos.x;
        let newY = evt.y - startPos.y;

        if (this._setConstraintDirection) {
            this._setConstraintDirection = false;
            this._constraintDirection = Math.abs(newX) >= Math.abs(newY) ? ConstraintDirection.X : ConstraintDirection.Y;
        }

        if (this._constraintDirection === ConstraintDirection.X) {
            newY = 0;
        } else if (this._constraintDirection === ConstraintDirection.Y) {
            newX = 0;
        }
        const referenceAxis = new Vector2(newX, newY);
        
        if (guiControl.typeName === "Line") {
            let line = guiControl as Line;
            const x1 = (line.x1 as string).substr(0, (line.x1 as string).length - 2); //removing the 'px'
            const x2 = (line.x2 as string).substr(0, (line.x2 as string).length - 2);
            const y1 = (line.y1 as string).substr(0, (line.y1 as string).length - 2);
            const y2 = (line.y2 as string).substr(0, (line.y2 as string).length - 2);
            line.x1 = Number(x1) + newX;
            line.x2 = Number(x2) + newX;
            line.y1 = Number(y1) + newY;
            line.y2 = Number(y2) + newY;
            return true;
        }

        let totalRotation = 0;
        let currentControl : Nullable<Control> = guiControl;
        while (currentControl) {
            totalRotation += currentControl.rotation;

            currentControl = currentControl.parent;
        }
        const rotatedReferenceAxis = new Vector2(0,0);

        // Rotate the reference axis by the total rotation of the control
        const sinR = Math.sin(-totalRotation);
        const cosR = Math.cos(-totalRotation);
        rotatedReferenceAxis.x = cosR * referenceAxis.x - sinR * referenceAxis.y;
        rotatedReferenceAxis.y = sinR * referenceAxis.x + cosR * referenceAxis.y;
        
        // Apply the amount of change
        guiControl.leftInPixels += rotatedReferenceAxis.x;
        guiControl.topInPixels += rotatedReferenceAxis.y;

        //convert to percentage
        if (this._responsive) {
            CoordinateHelper.convertToPercentage(guiControl, ["left", "top"]);
        }
        this.globalState.onPropertyGridUpdateRequiredObservable.notifyObservers();
        return true;
    }

    onMove(evt: React.PointerEvent) {
        var pos = this.getScaledPointerPosition();
        // Move or guiNodes
        if (this._mouseStartPoint != null && !this._panning) {
            let selected = false;
            this.globalState.selectedControls.forEach((element) => {
                if (pos) {
                    selected = this._onMove(element, new Vector2(pos.x, pos.y), this._mouseStartPoint!, false) || selected;
                }
            });

            this._mouseStartPoint = pos ? pos : this._mouseStartPoint;
        }
        this._pointerTravelDistance += evt.movementX * evt.movementX + evt.movementY * evt.movementY;
        if (this._panning) {
            this.panning();
        }
    }

    private _screenToTexturePosition(screenPos: Vector2) {
        const zoomVector = new Vector2(this._zoomFactor, this._zoomFactor);
        return screenPos.divideInPlace(zoomVector).add(this._panningOffset);
    }

    private getScaledPointerPosition() {
        return this._screenToTexturePosition(new Vector2(this._scene.pointerX, this._scene.pointerY));
    }

    startPanning() {
        this._panning = true;
        this._initialPanningOffset = this.getScaledPointerPosition();
    }

    endPanning() {
        this._panning = false;
    }

    processSelection() {
        console.log(this._controlsHit.map(control => control.name));
        if (this._controlsHit.length === 0) {
            this.globalState.setSelection([]);
            return;
        }
        // if child of selected control -> select on double click
        for(const control of this._controlsHit) {
            if (this.globalState.selectedControls.includes(control.parent!)) {
                if (this._doubleClick === control) {
                    this.globalState.select(control);
                    return;
                } else {
                    this._doubleClick = control;
                    window.setTimeout(() => {
                        this._doubleClick = null;
                    }, 300);
                }
            }
        }
        /* possible implementation if we decide to go with "up one level" approach
        let parent = selectedControls.length > 0 ? seletcedControls[0].parent : this._trueRootContainer;
        while(parent != null) {
            for(const control of this._controlsHit) {
                if (control.parent === parent) {
                    select(control);
                    return;
                }
            }
            parent = parent.parent;
        }
        DONE
        */
        // if control or sibling of control already selected -> select
        for (const control of this._controlsHit) {
            for(const selected of this.globalState.selectedControls) {
                if (selected.parent === control.parent) {
                    this.globalState.select(control);
                    return;
                }
                break; // we don't need to check any more since it's guaranteed that all selected controls have same parent
            }
        }
        // if control is child of root -> select
        for(const control of this._controlsHit) {
            if (control.parent === this._trueRootContainer) {
                this.globalState.select(control);
            }
        }
    }

    onDown(evt: React.PointerEvent<HTMLElement>) {
        this._pointerTravelDistance = 0;
        this._rootContainer.current?.setPointerCapture(evt.pointerId);

        if (this._forceSelecting) {
            this._mouseStartPoint = this.getScaledPointerPosition();
        }

        if (evt.button !== 0 || this._forcePanning) {
            this.startPanning();
        } else {
            if (this._forceZooming) {
                this.zooming(1.0 + (this._altKeyIsPressed ? -this._zoomModeIncrement : this._zoomModeIncrement));
            }
            this.endPanning();
            // process selection
            if (this.globalState.selectedControls.length !== 0) {
                this._processSelectionOnUp = true;
            }
            this._scene.onAfterRenderObservable.addOnce(() => {
                if (!this._processSelectionOnUp || this._controlsHit.length === 0) {
                    this.processSelection();
                    this._controlsHit = [];
                }
            });
        }
    }

    onUp(evt: React.PointerEvent) {
        this._mouseStartPoint = null;
        this._constraintDirection = ConstraintDirection.NONE;
        this._rootContainer.current?.releasePointerCapture(evt.pointerId);
        this._panning = false;
        if (this._processSelectionOnUp) {
            if (Math.sqrt(this._pointerTravelDistance) <= MAX_POINTER_TRAVEL_DISTANCE) {
                this.processSelection();
            }
            this._controlsHit = [];
            this._processSelectionOnUp = false;
        }
    }

    public createGUICanvas() {
        // Get the canvas element from the DOM.
        const canvas = this._rootContainer.current as HTMLCanvasElement;
        this._canvas = canvas;
        // Associate a Babylon Engine to it.
        this._engine = new Engine(canvas);

        // Create our first scene.
        this._scene = new Scene(this._engine);

        this._scene.clearColor = new Color4(0, 0, 0, 0);
        const light = new HemisphericLight("light1", Axis.Y, this._scene);
        light.intensity = 0.9;

        this._guiSize = this._defaultGUISize;

        this._panAndZoomContainer = new Container("panAndZoom");
        this._panAndZoomContainer.clipContent = false;
        this._panAndZoomContainer.clipChildren = false;

        this._visibleRegionContainer = new Container("visibleRegion");
        this._visibleRegionContainer.clipChildren = false;
        this._visibleRegionContainer.clipContent = false;
        this._visibleRegionContainer.widthInPixels = this.guiSize.width;
        this._visibleRegionContainer.heightInPixels = this.guiSize.height;
        this._panAndZoomContainer.addControl(this._visibleRegionContainer);

        const adt =
            this.globalState.guiTexture =
            this._visibleRegionContainer._host =
            this._panAndZoomContainer._host =
            AdvancedDynamicTexture.CreateFullscreenUI("guiTexture", true, this._scene, Texture.NEAREST_NEAREST_MIPNEAREST, false);

        adt.useInvalidateRectOptimization = false;
        this.trueRootContainer = adt.rootContainer;
        adt.onEndRenderObservable.add(() => this.globalState.onGizmoUpdateRequireObservable.notifyObservers());

        this.synchronizeLiveGUI();

        new ArcRotateCamera("Camera", 0, 0, 0, Vector3.Zero(), this._scene);
        // This attaches the mouse controls
        this.addControls(this._scene);

        this._scene.getEngine().onCanvasPointerOutObservable.clear();
        this._scene.doNotHandleCursors = true;

        // Watch for browser/canvas resize events
        this.globalState.hostWindow.addEventListener("resize", () => {
            this.globalState.onWindowResizeObservable.notifyObservers();
        });
        this._engine.resize();

        this.globalState.guiTexture.onBeginRenderObservable.add(() => {
            this.applyEditorTransformation();
        })

        this.globalState.onPropertyChangedObservable.add((ev) => {
            (ev.object as Control).markAsDirty(false);
            this.globalState.onArtBoardUpdateRequiredObservable.notifyObservers();
        })

        // Every time the original ADT re-renders, we must also re-render, so that layout information is computed correctly
        // also, every time *we* re-render (due to a change in the GUI), we must re-render the original ADT
        // to prevent an infite loop, we flip a boolean flag
        if (this.globalState.liveGuiTexture) {
            this._guiRenderObserver = this.globalState.guiTexture.onBeginRenderObservable.add(() => {
                if (this._liveGuiTextureRerender) {
                    this._nextLiveGuiRender = Date.now() + this._liveGuiRerenderDelay;
                }
                this._liveGuiTextureRerender = true;
            });
            this._liveRenderObserver = this.globalState.liveGuiTexture.onEndRenderObservable.add(() => {
                // return the GUI to the editor mode
                this.globalState.guiTexture?.markAsDirty();
                this._liveGuiTextureRerender = false;
            });
            this._scene.onAfterRenderObservable.add(() => {
                if (this._nextLiveGuiRender > 0 && Date.now() > this._nextLiveGuiRender) {
                    this._nextLiveGuiRender = -1;
                    this.globalState.liveGuiTexture?.markAsDirty();
                }
            })
        }

        this.globalState.onErrorMessageDialogRequiredObservable.notifyObservers(
            `Welcome to the GUI Editor Alpha. This editor is still a work in progress. Icons are currently temporary. Please submit feedback using the "Give feedback" button in the menu. `
        );
        this._engine.runRenderLoop(() => {
            this._scene.render();
        });
        this.globalState.onNewSceneObservable.notifyObservers(this.globalState.guiTexture.getScene());
        this.globalState.onPropertyGridUpdateRequiredObservable.notifyObservers();
        this.globalState.onFitToWindowObservable.notifyObservers();
    }

    // removes all controls from both GUIs, and re-adds the controls from the original to the GUI editor
    synchronizeLiveGUI() {
        if (this.globalState.liveGuiTexture) {
            this._trueRootContainer.getDescendants().forEach(desc => desc.dispose());
            this.globalState.liveGuiTexture.rootContainer.getDescendants(true).forEach(desc => {
                this.globalState.liveGuiTexture?.removeControl(desc);
                this.appendBlock(desc);
            })
            this.globalState.guiTexture.snippetId = this.globalState.liveGuiTexture.snippetId;
        }
    }

    //Add zoom and pan controls
    addControls(scene: Scene) {

        scene.onKeyboardObservable.add((k: KeyboardInfo, e: KeyboardEventTypes) => {
            switch (k.event.key) {
                case "s": //select
                case "S":
                    if (!this._forceSelecting) this.globalState.onSelectionButtonObservable.notifyObservers();
                    break;
                case "p": //pan
                case "P":
                    if (!this._forcePanning) this.globalState.onPanObservable.notifyObservers();
                    break;
                case "z": //zoom
                case "Z":
                    if (!this._forceZooming) this.globalState.onZoomObservable.notifyObservers();
                    break;
                case "g": //outlines
                case "G":
                    this.globalState.outlines = !this.globalState.outlines;
                    break;
                case "f": //fit to window
                case "F":
                    this.globalState.onFitToWindowObservable.notifyObservers();
                    break;
                case "ArrowUp": // move up
                    this.moveControls(false, k.event.shiftKey ? -ARROW_KEY_MOVEMENT_LARGE : -ARROW_KEY_MOVEMENT_SMALL);
                    break;
                case "ArrowDown": // move down
                    this.moveControls(false, k.event.shiftKey ? ARROW_KEY_MOVEMENT_LARGE : ARROW_KEY_MOVEMENT_SMALL);
                    break;
                case "ArrowLeft": // move left
                    this.moveControls(true, k.event.shiftKey ? -ARROW_KEY_MOVEMENT_LARGE : -ARROW_KEY_MOVEMENT_SMALL);
                    break;
                case "ArrowRight": // move right
                    this.moveControls(true, k.event.shiftKey ? ARROW_KEY_MOVEMENT_LARGE : ARROW_KEY_MOVEMENT_SMALL);
                default:
                    break;
            }
        }, KeyboardEventTypes.KEYDOWN);

        scene.onBeforeRenderObservable.add(() => {
            if (this._panAndZoomContainer.scaleX !== this._zoomFactor) {
                this._panAndZoomContainer.scaleX = this._zoomFactor;
                this._panAndZoomContainer.scaleY = this._zoomFactor;
                this.globalState.onArtBoardUpdateRequiredObservable.notifyObservers();
                this.globalState.onGizmoUpdateRequireObservable.notifyObservers();
            }
            const left = this._zoomFactor * this._panningOffset.x;
            const top = this._zoomFactor * -this._panningOffset.y;
            if (this._panAndZoomContainer.leftInPixels !== left || this._panAndZoomContainer.topInPixels !== top) {
                this._panAndZoomContainer.leftInPixels = left;
                this._panAndZoomContainer.topInPixels = top;
                this.globalState.onArtBoardUpdateRequiredObservable.notifyObservers();
                this.globalState.onGizmoUpdateRequireObservable.notifyObservers();
            }
        })

    }

    //Return offsets for inertial panning given initial and current pointer positions
    panning() {
        const panningDelta = this.getScaledPointerPosition().subtract(this._initialPanningOffset).multiplyByFloats(1, -1);
        this._panningOffset = this._panningOffset.add(panningDelta);
        this._initialPanningOffset = this.getScaledPointerPosition();
        this.globalState.onArtBoardUpdateRequiredObservable.notifyObservers();
        this.globalState.onGizmoUpdateRequireObservable.notifyObservers();
    }

    // Move the selected controls. Can be either on horizontal (leftInPixels) or 
    // vertical (topInPixels) direction
    moveControls(moveHorizontal: boolean, amount: number) {
        for (let selectedControl of this.globalState.selectedControls) {
            if (moveHorizontal) { // move horizontal
                const prevValue = selectedControl.leftInPixels;
                selectedControl.leftInPixels += amount;
                this.globalState.onPropertyChangedObservable.notifyObservers({
                    object: selectedControl,
                    property: "leftInPixels",
                    value: selectedControl.leftInPixels,
                    initialValue: prevValue
                });
                this.globalState.onPropertyGridUpdateRequiredObservable.notifyObservers();
            } else { // move vertical
                const prevValue = selectedControl.topInPixels;
                selectedControl.topInPixels += amount;
                this.globalState.onPropertyChangedObservable.notifyObservers({
                    object: selectedControl,
                    property: "topInPixels",
                    value: selectedControl.topInPixels,
                    initialValue: prevValue
                });
                this.globalState.onPropertyGridUpdateRequiredObservable.notifyObservers();
            }
        }
    }

    //Get the wheel delta
    zoomWheel(event: React.WheelEvent) {

        event.preventDefault();
        let delta = 0;
        if (event.deltaY) {
            delta = -event.deltaY;
        } else if (event.detail) {
            delta = -event.detail;
        }
        this.zooming(1 + (delta / 1000));
    }

    //Zoom to pointer position. Zoom amount determined by delta
    zooming(delta: number) {
        this._zoomFactor *= delta;
    }

    //Sets x y or z of passed in vector to zero if less than Epsilon
    zeroIfClose(vec: Vector3) {
        if (Math.abs(vec.x) < Epsilon) {
            vec.x = 0;
        }
        if (Math.abs(vec.y) < Epsilon) {
            vec.y = 0;
        }
        if (Math.abs(vec.z) < Epsilon) {
            vec.z = 0;
        }
    }

    render() {
        return (

            <canvas
                id="workbench-canvas"
                onPointerMove={(evt) => {
                    if (this.globalState.guiTexture) {
                        this.onMove(evt);
                    }
                    this.globalState.onPointerMoveObservable.notifyObservers(evt);
                }}
                onPointerDown={(evt) => this.onDown(evt)}
                onPointerUp={(evt) => {
                    this.onUp(evt);
                    this.globalState.onPointerUpObservable.notifyObservers(evt);
                }}
                onWheel={(evt) => this.zoomWheel(evt)}
                onContextMenu={(evt) => evt.preventDefault()}
                ref={this._rootContainer}>

            </canvas>

        );
    }
}
