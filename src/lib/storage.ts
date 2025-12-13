import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { CageCheck, SubState } from "../types.js";

const dir = join(process.cwd(), "data");
if (!existsSync(dir)) mkdirSync(dir);
const file = (name: string) => join(dir, name + ".json");

function read<T>(name: string, fallback: T): T {
  try {
    if (!existsSync(file(name))) write(name, fallback);
    return JSON.parse(readFileSync(file(name), "utf-8")) as T;
  } catch {
    return fallback;
  }
}
function write<T>(name: string, data: T) {
  writeFileSync(file(name), JSON.stringify(data, null, 2));
}

type DBShape = {
  checks: CageCheck[];
  subs: SubState[];
};

function now() { return Date.now(); }

export const DB = {
  load(): DBShape {
    return {
      checks: read<CageCheck[]>("checks", []),
      subs: read<SubState[]>("subs", []),
    };
  },
  save(data: DBShape) {
    write("checks", data.checks);
    write("subs", data.subs);
  },

  getAllChecks(): CageCheck[] { return read("checks", []); },
  setAllChecks(v: CageCheck[]) { write("checks", v); },

  getAllSubs(): SubState[] { return read("subs", []); },
  setAllSubs(v: SubState[]) { write("subs", v); },

  purgeOldChecks(retentionDays: number) {
    const cutoff = now() - retentionDays * 24 * 60 * 60 * 1000;
    const checks = DB.getAllChecks().filter(c => c.createdAt >= cutoff);
    DB.setAllChecks(checks);
  },

  getSubState(guildId: string, userId: string): SubState {
    const subs = DB.getAllSubs();
    let s = subs.find(x => x.guildId === guildId && x.userId === userId);
    if (!s) {
      s = { guildId, userId, consecutiveMisses: 0, lastUpdated: now() };
      DB.setAllSubs([...subs, s]);
    }
    return s;
  },

  updateSubState(state: SubState) {
    const subs = DB.getAllSubs().map(s =>
      s.guildId === state.guildId && s.userId === state.userId ? state : s
    );
    DB.setAllSubs(subs);
  }
};
