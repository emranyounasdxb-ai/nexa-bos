"use client";

import { useRef, useState } from "react";

import { controlClass } from "@/components/ui";
import { IconChevronDown } from "@/components/icons";
import { profileCountries } from "@/lib/profile-countries";
import styles from "./profile-nationality-select.module.css";

export function ProfileNationalitySelect({ id, value, disabled, onChange }: {
  id: string; value: string; disabled: boolean; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selected = profileCountries.find((country) => country.name === value);
  const choices = [
    { code: "empty", name: "Not recorded", flag: "", value: "" },
    ...(value && !selected ? [{ code: "existing", name: value, flag: "", value }] : []),
    ...profileCountries.map((country) => ({ ...country, value: country.name })),
  ].filter((country) => `${country.name} ${country.code}`.toLocaleLowerCase("en").includes(query.trim().toLocaleLowerCase("en")));

  function choose(index: number) {
    const option = choices[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    input.current?.focus();
  }

  function move(index: number) {
    setActive(index);
    document.getElementById(`${id}-option-${index}`)?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className={`relative mt-1.5 min-w-0 ${styles.countries}`}>
      <input ref={input} id={id} className={`${controlClass} pr-8`} role="combobox" aria-label="Nationality" autoComplete="off"
        aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open}
        aria-controls={`${id}-options`} aria-activedescendant={open && choices[active] ? `${id}-option-${active}` : undefined}
        disabled={disabled} placeholder="Select nationality"
        value={open ? query : `${selected ? `${selected.flag} ` : ""}${value}`}
        onClick={() => { setQuery(""); setActive(0); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            if (!open) { setQuery(""); setActive(0); setOpen(true); }
            else move(Math.max(0, Math.min(choices.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
          }
          if (event.key === "Enter") {
            event.preventDefault();
            if (open) choose(active);
            else { setQuery(""); setActive(0); setOpen(true); }
          }
          if (open && ["Home", "End"].includes(event.key)) {
            event.preventDefault(); move(event.key === "Home" ? 0 : choices.length - 1);
          }
        }} />
      <IconChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 top-2 size-4 text-text-disabled" />
      {open ? <div id={`${id}-options`} role="listbox" aria-label="Nationalities"
        className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-brand-border bg-surface p-1 shadow-lg">
        {choices.map((country, index) => <div key={country.code} id={`${id}-option-${index}`} role="option"
          aria-selected={country.value === value} data-country-code={country.code}
          className={`min-h-8 cursor-pointer rounded px-2 py-1.5 text-sm ${active === index ? "bg-brand-soft text-brand-primary" : "text-text-primary"}`}
          onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
          {country.flag ? <span aria-hidden="true">{country.flag} </span> : null}{country.name}
        </div>)}
        {!choices.length ? <p role="status" className="p-2 text-sm text-text-secondary">No matching countries</p> : null}
      </div> : null}
    </div>
  );
}
