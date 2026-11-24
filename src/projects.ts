import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { home } from './home.ts';
import { defaultReportDir, readPreviousRun } from './report/write.ts';
import { detectTarget } from './target.ts';
import type { Depth, Summary, Target, TargetKind } from './types.ts';

/** A folder the user keeps in the hub, with what the last run found. */
export interface Project {
  /** Stable for a path. Short enough to type. */
  id: string;
  path: string;
  name: string;
  /** Absent when the folder is gone or is no longer a theme, a plugin or a WordPress folder. */
  kind?: TargetKind;
  /** Themes and plugins inside a WordPress folder. */
  units: number;
  /** Why the folder cannot be tested now. */
  problem?: string;
  last?: {
    finishedAt: string;
    summary: Summary;
    /** Engines that failed, so the report is incomplete. */
    failed: number;
    profile?: string;
    depth?: Depth;
    /** The folder that holds the report files. */
    dir: string;
  };
}

interface Stored {
  schema: 1;
  projects: { path: string; addedAt: string }[];
}

const file = (): string => path.join(home(), 'projects.json');

export const projectId = (p: string): string => createHash('sha256').update(p).digest('hex').slice(0, 8);

function read(): Stored {
  try {
    const data = JSON.parse(readFileSync(file(), 'utf8')) as Stored | null;
    if (data?.schema === 1 && Array.isArray(data.projects)) {
      return { schema: 1, projects: data.projects.filter((p) => typeof p?.path === 'string' && path.isAbsolute(p.path)) };
    }
  } catch {
    // No file yet, or one that cannot be read. Both mean an empty list.
  }
  return { schema: 1, projects: [] };
}

function write(data: Stored): void {
  mkdirSync(home(), { recursive: true });
  // Write next to the file and rename, so a reader never sees half a file.
  const tmp = `${file()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file());
}

function describe(p: string): Project {
  let target: Target;
  try {
    target = detectTarget(p);
  } catch (err) {
    return { id: projectId(p), path: p, name: path.basename(p), units: 0, problem: err instanceof Error ? err.message : String(err) };
  }
  const dir = defaultReportDir(target);
  const run = readPreviousRun(dir);
  return {
    id: projectId(p),
    path: p,
    name: target.name,
    kind: target.kind,
    units: target.units.length,
    ...(run
      ? {
          last: {
            finishedAt: run.finishedAt,
            summary: run.summary,
            failed: run.engines.filter((e) => e.status === 'failed').length,
            ...(run.profile ? { profile: run.profile } : {}),
            ...(run.depth ? { depth: run.depth } : {}),
            dir,
          },
        }
      : {}),
  };
}

/** The projects in the order they were added, each with the result of its last run. */
export function listProjects(): Project[] {
  return read().projects.map((p) => describe(p.path));
}

/** Adds a folder. Throws when it is not a theme, a plugin or a WordPress folder. `added` is false when it was there already. */
export function addProject(input: string, now: () => Date = () => new Date()): { project: Project; added: boolean } {
  const target = detectTarget(input);
  const data = read();
  const added = !data.projects.some((p) => p.path === target.path);
  if (added) {
    data.projects.push({ path: target.path, addedAt: now().toISOString() });
    write(data);
  }
  return { project: describe(target.path), added };
}

/** Finds a project by its ID, its path or its name. A name that fits more than one project fits none. */
export function findProject(key: string): Project | undefined {
  const all = listProjects();
  const abs = path.resolve(key);
  const exact = all.find((p) => p.id === key || p.path === abs);
  if (exact) return exact;
  const named = all.filter((p) => p.name.toLowerCase() === key.toLowerCase());
  return named.length === 1 ? named[0] : undefined;
}

/** Takes a project off the list. Its reports stay. Returns false when no project fits. */
export function removeProject(key: string): boolean {
  const found = findProject(key);
  if (!found) return false;
  const data = read();
  write({ schema: 1, projects: data.projects.filter((p) => p.path !== found.path) });
  return true;
}
