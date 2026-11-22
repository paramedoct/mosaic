import { icon } from "../../icons";
import { navigateSuggestions, suggestedInput } from "./suggestions";
import { button, element, input } from "./ui";

export interface ImportSourceInput {
  wrapper: HTMLDivElement;
  summary: HTMLButtonElement;
  value(): string;
  reportValidity(): boolean;
  update(values: readonly string[]): void;
}

export interface ImportTagInput {
  wrapper: HTMLDivElement;
  summary: HTMLDivElement;
  tags(): string[];
  reportValidity(): boolean;
  update(values: readonly string[]): void;
}

export function importSourceInput(): ImportSourceInput {
  let values: readonly string[] = [];
  let source = "";
  const field = input("source");
  field.setAttribute("aria-label", "Source");
  field.autocomplete = "off";
  field.spellcheck = false;
  const summary = button("", () => {
    source = "";
    renderSummary();
    field.focus();
  }, "image-import-source-summary");
  summary.setAttribute("aria-live", "polite");

  function renderSummary(): void {
    summary.hidden = !source;
    summary.setAttribute("aria-label", source ? `Remove source ${source}` : "No source selected");
    summary.replaceChildren(element("span", "", "Source"), element("strong", "", source), icon("close"));
  }

  function commit(value = field.value): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    source = values.find(candidate => candidate.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
    field.value = "";
    field.setCustomValidity("");
    renderSummary();
    return true;
  }

  const wrapper = suggestedInput(field, value => {
    const query = value.trim().toLowerCase();
    return values.filter(choice => choice !== value && choice.toLowerCase().includes(query)).slice(0, 5)
      .map(choice => ({ label: choice, value: choice }));
  }, () => field.setCustomValidity(""), commit);
  wrapper.classList.add("image-import-source-field");
  wrapper.prepend(icon("source"));
  field.addEventListener("keydown", event => {
    if (event.isComposing || !field.value.trim() || event.key !== "Enter" && event.key !== "Tab") return;
    if (event.key === "Enter") event.preventDefault();
    commit();
    wrapper.querySelector(".scry-suggestions")?.replaceChildren();
  });
  wrapper.addEventListener("focusout", () => queueMicrotask(() => {
    if (wrapper.contains(document.activeElement)) return;
    commit();
  }));
  renderSummary();

  return {
    wrapper,
    summary,
    value: () => source,
    reportValidity(): boolean {
      commit();
      field.setCustomValidity(source ? "" : "Enter a source.");
      return field.reportValidity();
    },
    update(next: readonly string[]) { values = next; },
  };
}

function parseTags(value: string): string[] {
  return [...new Map(value.split(/[,\n]/).map(tag => tag.trim()).filter(Boolean)
    .map(tag => [tag.toLowerCase(), tag] as const)).values()];
}

export function importTagInput(): ImportTagInput {
  let values: readonly string[] = [];
  const tags: string[] = [];
  const wrapper = element("div", "scry-suggested-input image-import-tag-field");
  const summary = element("div", "image-import-tag-summary");
  summary.setAttribute("aria-label", "Selected tags");
  summary.setAttribute("aria-live", "polite");
  const entry = element("div", "image-import-tag-entry");
  const field = input("tag");
  field.setAttribute("aria-label", "Add tag");
  field.autocomplete = "off";
  field.spellcheck = false;
  entry.append(icon("tag"), field);
  const suggestions = element("div", "scry-suggestions");
  suggestions.setAttribute("role", "group");
  suggestions.setAttribute("aria-label", "Tag suggestions");
  wrapper.append(entry, suggestions);

  function renderTags(): void {
    summary.hidden = !tags.length;
    summary.replaceChildren(...tags.map((tag, index) => {
      const chip = button("", () => {
        tags.splice(index, 1);
        field.setCustomValidity("");
        renderTags();
        renderSuggestions();
        field.focus();
      }, "image-import-tag");
      chip.setAttribute("aria-label", `Remove tag ${tag}`);
      chip.append(element("span", "", tag), icon("close"));
      return chip;
    }));
  }

  function addTags(value: string): boolean {
    const existing = new Map(values.map(candidate => [candidate.toLowerCase(), candidate]));
    const selected = new Set(tags.map(tag => tag.toLowerCase()));
    let added = false;
    for (const parsed of parseTags(value)) {
      const key = parsed.toLowerCase();
      if (selected.has(key)) continue;
      tags.push(existing.get(key) ?? parsed);
      selected.add(key);
      added = true;
    }
    if (added) {
      field.setCustomValidity("");
      renderTags();
    }
    return added;
  }

  function commit(): boolean {
    const added = addTags(field.value);
    if (parseTags(field.value).length) field.value = "";
    renderSuggestions();
    return added;
  }

  function renderSuggestions(): void {
    const query = field.value.trim().toLowerCase();
    const selected = new Set(tags.map(tag => tag.toLowerCase()));
    suggestions.replaceChildren(...values.filter(value =>
      !selected.has(value.toLowerCase()) && value.toLowerCase().includes(query)).slice(0, 5).map(value => {
      const choice = button(value, () => {
        addTags(value);
        field.value = "";
        renderSuggestions();
        field.focus();
      });
      choice.onpointerdown = event => event.preventDefault();
      return choice;
    }));
  }

  entry.onclick = event => { if (event.target !== field) field.focus(); };
  field.onclick = renderSuggestions;
  field.oninput = () => {
    field.setCustomValidity("");
    const match = /^(.*[,\n])([^,\n]*)$/s.exec(field.value);
    if (match) {
      addTags(match[1]);
      field.value = match[2];
    }
    renderSuggestions();
  };
  field.onkeydown = event => {
    if (event.isComposing) return;
    if ((event.key === "," || event.key === "Enter" || event.key === "Tab") && field.value.trim()) {
      if (event.key !== "Tab") event.preventDefault();
      commit();
      return;
    }
    if (event.key === "Backspace" && !field.value && tags.length) {
      tags.pop();
      renderTags();
      renderSuggestions();
      return;
    }
    if (event.key === "Escape") {
      suggestions.replaceChildren();
      return;
    }
    if (event.key === "ArrowDown" && suggestions.firstElementChild) {
      event.preventDefault();
      (suggestions.firstElementChild as HTMLButtonElement).focus();
    }
  };
  wrapper.onkeydown = event => {
    if (event.target !== field) navigateSuggestions(event, field, suggestions);
  };
  wrapper.addEventListener("focusout", () => queueMicrotask(() => {
    if (wrapper.contains(document.activeElement)) return;
    commit();
    suggestions.replaceChildren();
  }));
  renderTags();

  return {
    wrapper,
    summary,
    tags: () => [...tags],
    reportValidity(): boolean {
      commit();
      field.setCustomValidity(tags.length ? "" : "Enter at least one tag.");
      return field.reportValidity();
    },
    update(next: readonly string[]) { values = next; },
  };
}
