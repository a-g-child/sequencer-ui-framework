export type PatternModifierState = {
  shift: boolean;
  alt: boolean;
  primary: boolean;
};

export class PatternInputState {
  readonly modifiers: PatternModifierState = {
    shift: false,
    alt: false,
    primary: false
  };

  setKeyboardModifiers(
    event: KeyboardEvent | PointerEvent | MouseEvent | WheelEvent
  ): void {
    this.modifiers.shift = event.shiftKey;
    this.modifiers.alt = event.altKey;
    this.modifiers.primary = event.metaKey || event.ctrlKey;
  }

  setTouchModifier(
    modifier: keyof PatternModifierState,
    enabled: boolean
  ): void {
    this.modifiers[modifier] = enabled;
  }

  clearModifiers(): void {
    this.modifiers.shift = false;
    this.modifiers.alt = false;
    this.modifiers.primary = false;
  }
}
