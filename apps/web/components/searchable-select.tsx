'use client';

import { useId, useMemo, useRef, useState } from 'react';

export interface SearchableOption { value: string; label: string; secondary?: string; keywords?: string }

export function SearchableSelect({ label, value, options, onChange, testId, placeholder = 'Search…', disabled = false }: { label: string; value: string; options: SearchableOption[]; onChange: (value: string) => void; testId?: string; placeholder?: string; disabled?: boolean }) {
  const id = useId();
  const listId=`${id}-listbox`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex,setActiveIndex]=useState(0);
  const buttonRef=useRef<HTMLButtonElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options.slice(0, 80);
    return options.filter((item) => `${item.label} ${item.secondary ?? ''} ${item.keywords ?? ''}`.toLocaleLowerCase().includes(needle)).slice(0, 80);
  }, [query, options]);
  const selected = options.find((item) => item.value === value);
  const close=()=>{setOpen(false);setQuery('');setActiveIndex(0);queueMicrotask(()=>buttonRef.current?.focus());};
  const choose=(index:number)=>{const option=filtered[index];if(!option)return;onChange(option.value);close();};
  return <div className="searchable-select"><span className="field-label">{label}</span>
    <button ref={buttonRef} type="button" data-testid={testId} aria-haspopup="listbox" aria-controls={listId} aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? 'Select…'}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="searchable-select-popover"><label className="sr-only" htmlFor={id}>{`Search ${label}`}</label><input id={id} autoFocus role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={filtered[activeIndex]?`${id}-option-${activeIndex}`:undefined} value={query} placeholder={placeholder} onChange={(event) => {setQuery(event.target.value);setActiveIndex(0);}} onKeyDown={(event) => { if (event.key === 'Escape'){event.preventDefault();close();} else if(event.key==='ArrowDown'&&filtered.length){event.preventDefault();setActiveIndex((i)=>(i+1)%filtered.length);} else if(event.key==='ArrowUp'&&filtered.length){event.preventDefault();setActiveIndex((i)=>(i-1+filtered.length)%filtered.length);} else if(event.key==='Enter'&&filtered[activeIndex]){event.preventDefault();choose(activeIndex);} }} />
      <div id={listId} role="listbox" aria-label={label}>{filtered.length ? filtered.map((item,index) => <button id={`${id}-option-${index}`} key={item.value} type="button" role="option" aria-selected={item.value === value} className={index===activeIndex?'active':''} onMouseEnter={()=>setActiveIndex(index)} onClick={() => choose(index)}><strong>{item.label}</strong>{item.secondary && <small>{item.secondary}</small>}</button>) : <p className="empty-inline">No matches.</p>}</div>
      {options.length > 80 && !query.trim() && <small className="search-hint">Showing the first 80. Type to filter {options.length.toLocaleString()} options.</small>}
    </div>}
  </div>;
}
