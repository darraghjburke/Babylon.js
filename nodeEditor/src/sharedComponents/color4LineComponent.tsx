import * as React from "react";
import { Observable } from "babylonjs/Misc/observable";
import { Color4 } from "babylonjs/Maths/math.color";
import { PropertyChangedEvent } from "./propertyChangedEvent";
import { NumericInputComponent } from "./numericInputComponent";
import { GlobalState } from "../globalState";
import { ColorPickerLineComponent } from "./colorPickerComponent";

const copyIcon: string = require("./copy.svg");
const plusIcon: string = require("./plus.svg");
const minusIcon: string = require("./minus.svg");

export interface IColor4LineComponentProps {
    label: string;
    target: any;
    propertyName: string;
    onPropertyChangedObservable?: Observable<PropertyChangedEvent>;
    onChange?: () => void;
    globalState: GlobalState;
}

export class Color4LineComponent extends React.Component<IColor4LineComponentProps, { isExpanded: boolean; }> {
    constructor(props: IColor4LineComponentProps) {
        super(props);

        this.state = { isExpanded: false };
    }

    onChange(newValue: string) {
        const newColor = Color4.FromHexString(newValue);
        this.updateColor(newColor);
    }

    switchExpandState() {
        this.setState({ isExpanded: !this.state.isExpanded });
    }

    updateColor(newValue: Color4) {
        const previousValue = this.getCurrentColor();
        if (newValue.equals(previousValue)) {
            return;
        }
        this.props.target[this.props.propertyName] = newValue;
        this.forceUpdate();
        if (this.props.onChange) {
            this.props.onChange();
        }

        if (!this.props.onPropertyChangedObservable) {
            return;
        }
        this.props.onPropertyChangedObservable.notifyObservers({
            object: this.props.target,
            property: this.props.propertyName,
            value: newValue,
            initialValue: previousValue,
        });
    }

    modifyColor(modifier: (previous: Color4) => void) {
        const color = this.getCurrentColor();
        modifier(color);

        this.updateColor(color);
    }

    getCurrentColor(): Color4 {
        return this.props.target[this.props.propertyName].clone();
    }

    copyToClipboard() {
        var element = document.createElement("div");
        element.textContent = this.getCurrentColor().toHexString();
        document.body.appendChild(element);

        if (window.getSelection) {
            var range = document.createRange();
            range.selectNode(element);
            window.getSelection()!.removeAllRanges();
            window.getSelection()!.addRange(range);
        }

        document.execCommand("copy");
        element.remove();
    }

    render() {
        const expandedIcon = this.state.isExpanded ? minusIcon : plusIcon;
        const color = this.getCurrentColor();

        return (
            <div className="color3Line">
                <div className="firstLine">
                    <div className="label" title={this.props.label}>
                        {this.props.label}
                    </div>
                    <div className="color3">
                        <ColorPickerLineComponent
                            globalState={this.props.globalState}
                            value={color}
                            onColorChanged={(color) => {
                                this.onChange(color);
                            }}
                        />
                    </div>
                    <div className="copy hoverIcon" onClick={() => this.copyToClipboard()} title="Copy to clipboard">
                        <img src={copyIcon} alt="" />
                    </div>
                    <div className="expand hoverIcon" onClick={() => this.switchExpandState()} title="Expand">
                        <img src={expandedIcon} alt="" />
                    </div>
                </div>
                {this.state.isExpanded && (
                    <div className="secondLine">
                        <NumericInputComponent globalState={this.props.globalState} label="r" value={color.r} onChange={(value) => this.modifyColor((col) => col.r = value)} />
                        <NumericInputComponent globalState={this.props.globalState} label="g" value={color.g} onChange={(value) => this.modifyColor((col) => col.g = value)} />
                        <NumericInputComponent globalState={this.props.globalState} label="b" value={color.b} onChange={(value) => this.modifyColor((col) => col.b = value)} />
                        <NumericInputComponent globalState={this.props.globalState} label="a" value={color.a} onChange={(value) => this.modifyColor((col) => col.a = value)} />
                    </div>
                )}
            </div>
        );
    }
}
