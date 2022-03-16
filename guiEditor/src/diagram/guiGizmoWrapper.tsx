import { Nullable } from "babylonjs/types";
import { Observer } from "babylonjs/Misc/observable";
import * as React from "react";
import { GlobalState } from "../globalState";
import { GuiGizmoComponent } from "./guiGizmo";
import { GizmoLine } from "./guiGizmoLine";
import { Line } from "babylonjs-gui/2D/controls/line";

export interface IGizmoWrapperProps {
    globalState: GlobalState;
}

export class GizmoWrapper extends React.Component<IGizmoWrapperProps> {
    observer: Nullable<Observer<void>>;
    componentWillMount() {
        this.observer = this.props.globalState.onSelectionChangedObservable.add(() => this.forceUpdate());
    }

    componentWillUnmount() {
        this.props.globalState.onSelectionChangedObservable.remove(this.observer);
    }

    render() {
        const controls = this.props.globalState.selectedControls;
        return <>
            {controls.map(control =>
                control.getClassName() === "Line" ?
                <GizmoLine globalState={this.props.globalState} control={control as Line} key={control.uniqueId} /> :
                <GuiGizmoComponent globalState={this.props.globalState} control={control} key={control.uniqueId}/>)}
        </>;
    }
}