"use client";

import { createContext, useContext } from "react";

type Roster = { agents: string[]; dispatchers: string[] };

const RosterContext = createContext<Roster>({ agents: [], dispatchers: [] });

// The active Agents and Dispatchers, read once per page from the roster the
// admins manage. Every dropdown that offers these names reads from here.
export function RosterProvider({ agents, dispatchers, children }: Roster & { children: React.ReactNode }) {
  return <RosterContext.Provider value={{ agents, dispatchers }}>{children}</RosterContext.Provider>;
}

export function useRoster(): Roster {
  return useContext(RosterContext);
}

// A job or lead keeps the name it was saved with even after that person is
// deactivated, so a dropdown always lists the current value too — otherwise
// opening the record and saving would quietly blank it.
export function withCurrent(options: string[], current: string | null | undefined): string[] {
  const value = (current ?? "").trim();
  return value && !options.includes(value) ? [...options, value] : options;
}
