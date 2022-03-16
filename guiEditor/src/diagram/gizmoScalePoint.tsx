import * as React from "react";
import { Vector2 } from "babylonjs/Maths/math.vector";

// which side of the bounding box are we on?
export enum ScalePointPosition {
    Top = -1,
    Left = -1,
    Center = 0,
    Right = 1,
    Bottom = 1,
}

// a single gizmo scale point on the bounding box
export interface IScalePoint {
    position: Vector2;
    horizontalPosition: ScalePointPosition;
    verticalPosition: ScalePointPosition;
    rotation: number;
    isPivot: boolean;
    defaultRotation: number;
}

interface IGizmoScalePointProps {
    scalePoint: IScalePoint;
    clickable: boolean;
    key: number;
    onDrag: () => void;
    onRotate: () => void;
    onUp: () => void;
    cursor?: string;
}

const gizmoPivotIcon: string = require("../../public/imgs/gizmoPivotIcon.svg");

// load in custom cursor icons
const cursorScaleDiagonaLeft: string = `url("${require("../../public/imgs/cursor_scaleDiagonalLeft.svg")}") 12 12, nwse-resize`;
const cursorScaleDiagonalRight: string = `url("${require("../../public/imgs/cursor_scaleDiagonalRight.svg")}") 12 12, nesw-resize`;
const cursorScaleHorizontal: string = `url("${require("../../public/imgs/cursor_scaleHorizontal.svg")}") 12 12, pointer`;
const cursorScaleVertical: string = `url("${require("../../public/imgs/cursor_scaleVertical.svg")}") 12 12, ns-resize`;
const scalePointCursors = [cursorScaleVertical, cursorScaleDiagonalRight, cursorScaleHorizontal, cursorScaleDiagonaLeft, cursorScaleVertical, cursorScaleDiagonalRight, cursorScaleHorizontal, cursorScaleDiagonaLeft];
const rotateCursors : string[] = [];
for(let idx = 0; idx < 8; idx++) {
    rotateCursors.push(`url("${require(`../../public/imgs/cursor_rotate${idx}.svg`)}") 12 12, pointer`);
}

const modulo = (dividend: number, divisor: number) => ((dividend % divisor) + divisor) % divisor;

export function GizmoScalePoint(props: IGizmoScalePointProps) {
    const {scalePoint, clickable, onDrag, onRotate, onUp, cursor} = props;

    const style: React.CSSProperties = {
        left: `${scalePoint.position.x}px`,
        top: `${scalePoint.position.y}px`,
        transform: "translate(-50%, -50%) rotate(" + scalePoint.rotation + "deg)",
        pointerEvents: clickable ? "auto" : "none"
    };

    if (scalePoint.isPivot) {
        return <img className="pivot-point" src={gizmoPivotIcon} style={style} />;
    }
    // compute which cursor icon to use on hover
    const angleOfCursor = (scalePoint.defaultRotation + scalePoint.rotation);
    const angleAdjusted = modulo(angleOfCursor, 360);
    const increment = 45;
    let cursorIndex = Math.round(angleAdjusted / increment) % 8;
    const cursorIcon = cursor || scalePointCursors[cursorIndex];
    const scalePointContainerSize = 30; // .scale-point-container width/height in px
    const rotateClickAreaSize = 20; // .rotate-click-area width/height
    const rotateClickAreaOffset = 7; // how much to offset the invisible rotate click area from the center
    const rotateClickAreaStyle = {
        top: (scalePointContainerSize - rotateClickAreaSize) / 2 + rotateClickAreaOffset * scalePoint.verticalPosition,
        left: (scalePointContainerSize - rotateClickAreaSize) / 2 + rotateClickAreaOffset * scalePoint.horizontalPosition,
        cursor: rotateCursors[cursorIndex]
    }
    const scaleClickAreaSize = 20; // .scale-click-area width/height
    const scaleClickAreaOffset = 5; // how much to offset the invisible scale click area from the center
    console.log(cursor,cursorIcon);
    const scaleClickAreaStyle = {
        top: (scalePointContainerSize - scaleClickAreaSize) / 2 - scaleClickAreaOffset * scalePoint.verticalPosition,
        left: (scalePointContainerSize - scaleClickAreaSize) / 2 - scaleClickAreaOffset * scalePoint.horizontalPosition,
        cursor: cursorIcon
    }
    return (
        <div style={style} className="scale-point-container">
            <div
                className="rotate-click-area"
                onPointerDown={onRotate}
                style={rotateClickAreaStyle}
            >
            </div>
            <div
                className="scale-click-area"
                draggable={true}
                onDragStart={(evt) => evt.preventDefault()}
                onPointerDown={(event) => {
                    // if left mouse button down
                    if (event.buttons & 1) {
                        onDrag();
                    }
                }}
                onPointerUp={onUp}
                style={scaleClickAreaStyle}
            >
            </div>
            <div
                className="scale-point"
                draggable={true}
                onDragStart={(evt) => evt.preventDefault()}
                onPointerDown={(event) => {
                    if (event.buttons & 1) {
                        onDrag();
                    }
                }}
                onPointerUp={onUp}
                style={{cursor}}
            >
            </div>
        </div>
    );
}