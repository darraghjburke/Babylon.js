import * as React from "react";
import { Observable } from "babylonjs/Misc/observable";
import { Tools } from "babylonjs/Misc/tools";
import { PropertyChangedEvent } from "./propertyChangedEvent";
import { FloatLineComponent } from "./floatLineComponent";
import { GlobalState } from "../globalState";

interface ISliderLineComponentProps {
    label: string;
    target?: any;
    propertyName?: string;
    minimum: number;
    maximum: number;
    step: number;
    directValue?: number;
    useEuler?: boolean;
    onChange?: (value: number) => void;
    onInput?: (value: number) => void;
    onPropertyChangedObservable?: Observable<PropertyChangedEvent>;
    decimalCount?: number;
    globalState: GlobalState;
}

export class SliderLineComponent extends React.Component<ISliderLineComponentProps, { value: number }> {
    private _localChange = false;
    constructor(props: ISliderLineComponentProps) {
        super(props);

        if (this.props.directValue !== undefined) {
            this.state = {
                value: this.props.directValue,
            };
        } else {
            let value = this.props.target![this.props.propertyName!];

            if (value === undefined) {
                value = this.props.maximum;
            }
            this.state = { value: value };
        }
    }

    shouldComponentUpdate(nextProps: ISliderLineComponentProps, nextState: { value: number }) {
        if (nextProps.directValue !== undefined) {
            nextState.value = nextProps.directValue;
            return true;
        }

        let currentState = nextProps.target![nextProps.propertyName!];
        if (currentState === undefined) {
            currentState = nextProps.maximum;
        }

        if (currentState !== nextState.value || nextProps.minimum !== this.props.minimum || nextProps.maximum !== this.props.maximum || this._localChange) {
            nextState.value = Math.min(Math.max(currentState, nextProps.minimum), nextProps.maximum);
            this._localChange = false;
            return true;
        }
        return false;
    }

    onChange(newValueString: any) {
        this._localChange = true;
        let newValue = parseFloat(newValueString);

        if (this.props.useEuler) {
            newValue = Tools.ToRadians(newValue);
        }

        if (this.props.target) {
            if (this.props.onPropertyChangedObservable) {
                this.props.onPropertyChangedObservable.notifyObservers({
                    object: this.props.target,
                    property: this.props.propertyName!,
                    value: newValue,
                    initialValue: this.state.value,
                });
            }

            this.props.target[this.props.propertyName!] = newValue;
        }

        if (this.props.onChange) {
            this.props.onChange(newValue);
        }

        this.setState({ value: newValue });
    }

    onInput(newValueString: any) {
        const newValue = parseFloat(newValueString);
        if (this.props.onInput) {
            this.props.onInput(newValue);
        }
    }

    prepareDataToRead(value: number) {
        if (this.props.useEuler) {
            return Tools.ToDegrees(value);
        }

        return value;
    }

    render() {
        return (
            <div className="sliderLine">
                <div className="label" title={this.props.label}>
                    {this.props.label}
                </div>
                <FloatLineComponent
                    globalState={this.props.globalState}
                    smallUI={true}
                    label=""
                    target={this.state}
                    propertyName="value"
                    min={this.prepareDataToRead(this.props.minimum)}
                    max={this.prepareDataToRead(this.props.maximum)}
                    onEnter={() => {
                        this.onChange(this.state.value);
                    }}
                ></FloatLineComponent>
                <div className="slider">
                    <input
                        className="range"
                        type="range"
                        step={this.props.step}
                        min={this.prepareDataToRead(this.props.minimum)}
                        max={this.prepareDataToRead(this.props.maximum)}
                        value={this.prepareDataToRead(this.state.value)}
                        onInput={(evt) => this.onInput((evt.target as HTMLInputElement).value)}
                        onChange={(evt) => this.onChange(evt.target.value)}
                    />
                </div>
            </div>
        );
    }
}
