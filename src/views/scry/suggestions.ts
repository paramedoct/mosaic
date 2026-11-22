import { button, element } from "./ui";

export interface Suggestion {
  label: string;
  value: string;
}

export function navigateSuggestions(
  event: KeyboardEvent, field: HTMLInputElement, suggestions: HTMLElement,
): boolean {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return false;
  const choices = [...suggestions.querySelectorAll("button")];
  const index = choices.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === "ArrowDown" ? choices[index + 1] : choices[index - 1] ?? field;
  if (!choices.length || !next) return false;
  event.preventDefault();
  next.focus();
  return true;
}

export function suggestedInput(
  field: HTMLInputElement, choices: (value: string) => readonly Suggestion[], edited?: () => void,
  selected?: (value: string) => void,
): HTMLDivElement {
  const wrapper = element("div", "scry-suggested-input");
  const suggestions = element("div", "scry-suggestions");
  suggestions.setAttribute("role", "group");
  suggestions.setAttribute("aria-label", `${field.placeholder} suggestions`);
  wrapper.append(field, suggestions);

  function render(): void {
    suggestions.replaceChildren(...choices(field.value).map(({ label, value }) => button(label, () => {
      field.value = value;
      field.focus();
      if (label.endsWith(":") && edited && value.endsWith(":")) render();
      else suggestions.replaceChildren();
      edited?.();
      selected?.(value);
    })));
  }

  field.onclick = render;
  field.oninput = () => {
    render();
    edited?.();
  };
  wrapper.addEventListener("focusout", event => {
    if (!wrapper.contains(event.relatedTarget as Node | null)) suggestions.replaceChildren();
  });
  wrapper.onkeydown = event => {
    if (event.key === "Escape" && suggestions.childElementCount) {
      event.preventDefault();
      field.focus();
      suggestions.replaceChildren();
      return;
    }
    if (!suggestions.childElementCount && event.target === field && event.key === "ArrowDown") render();
    navigateSuggestions(event, field, suggestions);
  };
  return wrapper;
}
