import { ExpansionEntry, StubReason } from './expansion';
import { approximateTokens } from './tokenCounting';

/**
 * What the tree says beside a Stub, where it has no content to point at.
 *
 * The tree is read before anything below it, so it has to answer the question
 * it provokes: a name with no content underneath is either a Stub or a defect,
 * and only the tree can say which. The wording is the short form of the notice
 * the entry itself carries, so the two never read as different claims.
 */
const stubAnnotations: Record<StubReason, string> = {
    'binary': '(omitted: binary)',
    'too-large': '(omitted: too large)',
    'unreadable': '(omitted: unreadable)'
};

/**
 * What the tree says beside an embedded file: what it costs to paste.
 *
 * A total tells the user an Export is too big; only a count per file tells
 * them which file to drop. It sits in the same slot a Stub's reason does,
 * and the two never compete for it — a Stub has no content and so no tokens.
 */
function tokenAnnotation(count: number | undefined): string | undefined {
    return count === undefined ? undefined : `(${approximateTokens(count)})`;
}

/** Children keyed by name, in the order the entries introduced them. */
interface TreeNode {
    children: Map<string, TreeNode>;
    /** Set on the node an entry ends at: its Stub reason or its cost. */
    annotation?: string;
}

/**
 * The shape of an Export, drawn from exactly the entries it contains.
 *
 * The document is read by a model more often than by a person, and a model
 * reading a flat sequence of headings has to reconstruct the project's shape
 * from the paths before it can reason about any of the code. The tree hands it
 * that shape up front.
 *
 * Directories are named with a trailing separator and files without one, so a
 * leaf is never mistaken for an empty folder. Order is the order of the
 * entries themselves, which is also the order of the sections below: reading
 * the tree downwards is reading the Export downwards.
 *
 * Nothing is invented. A directory appears only because an entry passes
 * through it, so the tree cannot claim a file the Export does not carry, and
 * every entry reaches a leaf, so it cannot omit one either.
 *
 * `tokenCounts` is keyed by relative path. A file missing from it is one that
 * could not be read when it was measured, and it is left unannotated rather
 * than annotated with a nought it did not earn.
 */
export function renderFileTree(
    entries: ExpansionEntry[],
    tokenCounts?: ReadonlyMap<string, number>
): string {
    const root: TreeNode = { children: new Map() };

    for (const entry of entries) {
        // Both separators, because the relative path was made on whichever
        // platform the Export is running on.
        const segments = entry.relativePath.split(/[/\\]/).filter(segment => segment.length > 0);
        if (segments.length === 0) {
            continue;
        }

        let node = root;
        for (const segment of segments) {
            let child = node.children.get(segment);
            if (!child) {
                child = { children: new Map() };
                node.children.set(segment, child);
            }
            node = child;
        }

        node.annotation = entry.classification === 'stub'
            ? stubAnnotations[entry.reason]
            : tokenAnnotation(tokenCounts?.get(entry.relativePath));
    }

    // The workspace root is drawn as `.`, so a Selection of one file still has
    // something to hang from and the tree never starts mid-air.
    const lines = ['.'];
    appendChildren(root, '', lines);
    return `${lines.join('\n')}\n`;
}

function appendChildren(node: TreeNode, prefix: string, lines: string[]): void {
    const children = [...node.children.entries()];

    children.forEach(([name, child], index) => {
        const last = index === children.length - 1;
        const isDirectory = child.children.size > 0;
        const label = isDirectory ? `${name}/` : name;
        const annotation = child.annotation ? `  ${child.annotation}` : '';

        lines.push(`${prefix}${last ? '└── ' : '├── '}${label}${annotation}`);
        appendChildren(child, `${prefix}${last ? '    ' : '│   '}`, lines);
    });
}
