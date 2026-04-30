import type { AdoPipeline } from '../api/types';

export interface FolderNode {
  name: string;
  folders: FolderNode[];
  pipelines: AdoPipeline[];
}

export function parsePath(input: string): string[] {
  return input.split(/[\\/]+/).filter(Boolean);
}

export function buildFolderTree(pipelines: AdoPipeline[]): FolderNode {
  const root: FolderNode = { name: '', folders: [], pipelines: [] };
  for (const p of pipelines) {
    const segs = parsePath(p.folder ?? '');
    let cur = root;
    for (const seg of segs) {
      let next = cur.folders.find((f) => f.name.toLowerCase() === seg.toLowerCase());
      if (!next) {
        next = { name: seg, folders: [], pipelines: [] };
        cur.folders.push(next);
      }
      cur = next;
    }
    cur.pipelines.push(p);
  }
  // Sort recursively.
  const sortNode = (n: FolderNode) => {
    n.folders.sort((a, b) => a.name.localeCompare(b.name));
    n.pipelines.sort((a, b) => a.name.localeCompare(b.name));
    n.folders.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

export function navigateTo(root: FolderNode, segs: string[]): { node: FolderNode | null; canonical: string[] } {
  let cur: FolderNode | null = root;
  const canonical: string[] = [];
  for (const seg of segs) {
    if (!cur) return { node: null, canonical };
    const next: FolderNode | undefined = cur.folders.find((f) => f.name.toLowerCase() === seg.toLowerCase());
    if (!next) return { node: null, canonical };
    canonical.push(next.name);
    cur = next;
  }
  return { node: cur, canonical };
}
