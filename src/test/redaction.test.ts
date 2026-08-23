import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';
import { createBufferedDestination } from '../core/destinations';
import { createExport, ExportStatistics } from '../core/export';
import { ExpansionEntry } from '../core/expansion';
import { resolvedConfiguration, withWorkspace } from './workspace';

function embedded(root: string, relativePath: string): ExpansionEntry {
    return {
        absolutePath: path.join(root, relativePath),
        relativePath,
        classification: 'embed'
    };
}

interface RenderResult {
    markdown: string;
    statistics: ExportStatistics;
}

async function render(
    entries: ExpansionEntry[],
    configuration = resolvedConfiguration()
): Promise<RenderResult> {
    const destination = createBufferedDestination();
    const statistics = await createExport({ entries, configuration, destination });
    return { markdown: destination.text(), statistics };
}

/** The body of one entry's fenced section, between its heading and the rule that ends it. */
function sectionFor(markdown: string, relativePath: string): string {
    const heading = `\n## ${relativePath}\n\n`;
    const start = markdown.indexOf(heading);
    assert.notEqual(start, -1, `no section for ${relativePath}`);
    const body = markdown.slice(start + heading.length);
    const end = body.indexOf('\n---\n');
    return end === -1 ? body : body.slice(0, end);
}

/** The approximate token count the tree states for one leaf, comma grouping undone. */
function treeTokenCountFor(markdown: string, fileName: string): number {
    const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escaped}\\s+\\(~([\\d,]+) tokens?\\)`).exec(markdown);
    assert.ok(match, `no token count in the tree for ${fileName}`);
    return Number(match[1].replace(/,/g, ''));
}

test('a .env file has its values masked and its keys kept', async () => {
    await withWorkspace({
        '.env': 'API_KEY=abcd1234wxyz\nDEBUG=true\n'
    }, async root => {
        const { markdown } = await render([embedded(root, '.env')]);
        const section = sectionFor(markdown, '.env');

        assert.equal(section.includes('API_KEY=[REDACTED: value]'), true);
        assert.equal(section.includes('DEBUG=[REDACTED: value]'), true);
        assert.equal(markdown.includes('abcd1234wxyz'), false);
        assert.equal(markdown.includes('=true'), false);
    });
});

test('.env variants are all recognised by name, not only .env itself', async () => {
    const names = ['.env', '.env.local', '.env.production', '.env.development', '.env.test', '.env.example'];
    const files: Record<string, string> = {};
    for (const name of names) {
        files[name] = `SECRET=value-of-${name}\n`;
    }

    await withWorkspace(files, async root => {
        const { markdown } = await render(names.map(name => embedded(root, name)));

        for (const name of names) {
            const section = sectionFor(markdown, name);
            assert.equal(section.includes('SECRET=[REDACTED: value]'), true, name);
            assert.equal(section.includes(`value-of-${name}`), false, name);
        }
    });
});

test('a name that merely contains "env" is not treated as a dotenv file', async () => {
    await withWorkspace({ 'environment.ts': 'export const KEY = "not-a-secret-value";\n' }, async root => {
        const { markdown } = await render([embedded(root, 'environment.ts')]);

        assert.equal(markdown.includes('KEY = "not-a-secret-value"'), true);
    });
});

test('a quoted .env value keeps its quotes around the marker', async () => {
    await withWorkspace({
        '.env': 'DOUBLE="a secret value"\nSINGLE=\'another secret\'\nBARE=unquoted-secret\n'
    }, async root => {
        const { markdown } = await render([embedded(root, '.env')]);
        const section = sectionFor(markdown, '.env');

        assert.equal(section.includes('DOUBLE="[REDACTED: value]"'), true);
        assert.equal(section.includes('SINGLE=\'[REDACTED: value]\''), true);
        assert.equal(section.includes('BARE=[REDACTED: value]'), true);
    });
});

test('an .env line with no value has nothing to Redact and is left as it was', async () => {
    await withWorkspace({ '.env': 'EMPTY=\nSPACES=   \n' }, async root => {
        const { markdown, statistics } = await render([embedded(root, '.env')]);
        const section = sectionFor(markdown, '.env');

        assert.equal(section.includes('EMPTY=\n'), true);
        assert.equal(section.includes('[REDACTED'), false);
        assert.equal(statistics.redactionCount, 0);
    });
});

test('a comment inside a .env file is still swept for a stray credential', async () => {
    await withWorkspace({
        '.env': '# TODO: rotate AKIAABCDEFGHIJKLMNOP before shipping\nREAL_KEY=fine\n'
    }, async root => {
        const { markdown } = await render([embedded(root, '.env')]);
        const section = sectionFor(markdown, '.env');

        assert.equal(section.includes('[REDACTED: AWS access key]'), true);
        assert.equal(section.includes('AKIAABCDEFGHIJKLMNOP'), false);
        // The comment is not an assignment, so it is swept but not masked as
        // a KEY=VALUE line: only the credential inside it is replaced, and
        // the rest of the comment's own wording survives untouched.
        assert.equal(
            section.includes('# TODO: rotate [REDACTED: AWS access key] before shipping'),
            true
        );
    });
});

test('a recognisable credential inside an ordinary source file is Redacted wherever it appears', async () => {
    const content = [
        'export const config = {',
        '  openai: "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop",',
        '  ordinary: "just a normal string, nothing sensitive here"',
        '};',
        ''
    ].join('\n');

    await withWorkspace({ 'config.ts': content }, async root => {
        const { markdown } = await render([embedded(root, 'config.ts')]);
        const section = sectionFor(markdown, 'config.ts');

        assert.equal(section.includes('[REDACTED: OpenAI API key]'), true);
        assert.equal(section.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ'), false);
        // What was not a credential is untouched.
        assert.equal(section.includes('just a normal string, nothing sensitive here'), true);
    });
});

test('each known credential shape is recognised and named in its marker', async () => {
    const cases: [string, string, string][] = [
        ['aws.txt', 'key = AKIAABCDEFGHIJKLMNOP', '[REDACTED: AWS access key]'],
        ['aws-temp.txt', 'key = ASIAABCDEFGHIJKLMNOP', '[REDACTED: AWS access key]'],
        ['github-classic.txt', 'token = ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', '[REDACTED: GitHub token]'],
        ['github-fine.txt', 'token = github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123', '[REDACTED: GitHub token]'],
        ['stripe.txt', 'key = sk_live_51ABCDEFGHIJKLMNOPQRSTUVWX', '[REDACTED: Stripe key]'],
        ['openai.txt', 'key = sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij', '[REDACTED: OpenAI API key]'],
        ['anthropic.txt', 'key = sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh', '[REDACTED: Anthropic API key]'],
        [
            'jwt.txt',
            'token = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
            '[REDACTED: JWT]'
        ],
        [
            'db.txt',
            'url = postgres://admin:hunter2Secret@db.example.com:5432/prod',
            '[REDACTED: database password]'
        ]
    ];

    const files: Record<string, string> = {};
    for (const [name, content] of cases) {
        files[name] = `${content}\n`;
    }

    await withWorkspace(files, async root => {
        const { markdown } = await render(cases.map(([name]) => embedded(root, name)));

        for (const [name, , label] of cases) {
            const section = sectionFor(markdown, name);
            assert.equal(section.includes(label), true, `${name} did not get ${label}`);
        }
    });
});

test('a database URL keeps its scheme, user and host — only the password is Redacted', async () => {
    await withWorkspace({
        'notes.md': 'Connect with `postgres://admin:hunter2Secret@db.example.com:5432/prod`.\n'
    }, async root => {
        const { markdown } = await render([embedded(root, 'notes.md')]);
        const section = sectionFor(markdown, 'notes.md');

        assert.equal(
            section.includes('postgres://admin:[REDACTED: database password]@db.example.com:5432/prod'),
            true
        );
        assert.equal(section.includes('hunter2Secret'), false);
    });
});

test('an Anthropic key is never mistaken for the generic OpenAI shape it also matches', async () => {
    await withWorkspace({
        'a.ts': 'const key = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh";\n'
    }, async root => {
        const { markdown } = await render([embedded(root, 'a.ts')]);
        const section = sectionFor(markdown, 'a.ts');

        assert.equal(section.includes('[REDACTED: Anthropic API key]'), true);
        assert.equal(section.includes('OpenAI'), false);
    });
});

test('the number of Redactions is reported when the Export completes', async () => {
    await withWorkspace({
        '.env': 'KEY_ONE=secret1\nKEY_TWO=secret2\n',
        'src/config.ts': 'export const k = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";\n',
        'README.md': 'Nothing sensitive in here.\n'
    }, async root => {
        const { statistics } = await render([
            embedded(root, '.env'),
            embedded(root, path.join('src', 'config.ts')),
            embedded(root, 'README.md')
        ]);

        // Two .env values plus one credential in config.ts; README contributes none.
        assert.equal(statistics.redactionCount, 3);
    });
});

test('Redaction disabled leaves .env values and embedded credentials untouched', async () => {
    await withWorkspace({
        '.env': 'API_KEY=abcd1234wxyz\n',
        'a.ts': 'const key = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";\n'
    }, async root => {
        const { markdown, statistics } = await render(
            [embedded(root, '.env'), embedded(root, 'a.ts')],
            resolvedConfiguration({ redactionEnabled: false })
        );

        assert.equal(markdown.includes('API_KEY=abcd1234wxyz'), true);
        assert.equal(markdown.includes('sk-ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'), true);
        assert.equal(markdown.includes('[REDACTED'), false);
        assert.equal(statistics.redactionCount, 0);
    });
});

test('a file with nothing sensitive is not touched, byte for byte', async () => {
    const content = [
        'export function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        ''
    ].join('\n');

    await withWorkspace({ 'math.ts': content }, async root => {
        const { markdown, statistics } = await render([embedded(root, 'math.ts')]);

        assert.equal(sectionFor(markdown, 'math.ts').startsWith('```typescript\n' + content), true);
        assert.equal(statistics.redactionCount, 0);
    });
});

test('a Stub never has its content scanned — Redaction only touches embedded files', async () => {
    await withWorkspace({ 'huge.log': 'AKIAABCDEFGHIJKLMNOP\n' }, async root => {
        const { markdown, statistics } = await render([{
            absolutePath: path.join(root, 'huge.log'),
            relativePath: 'huge.log',
            classification: 'stub',
            reason: 'too-large'
        }]);

        assert.equal(markdown.includes('AKIAABCDEFGHIJKLMNOP'), false);
        assert.equal(markdown.includes('[REDACTED'), false);
        assert.equal(statistics.redactionCount, 0);
    });
});

test('token counting sees the Redacted text, not the secret it replaced', async () => {
    // Long enough that counting the raw secret instead of its marker would
    // produce a visibly different number.
    const secret = 'sk-ant-api03-' + 'A'.repeat(120);

    await withWorkspace({
        'secret.ts': `const key = "${secret}";\n`,
        // What secret.ts should read like once Redacted — built by hand so
        // this test does not depend on the exact marker text staying in sync
        // with redaction.ts on its own.
        'already-redacted.ts': 'const key = "[REDACTED: Anthropic API key]";\n'
    }, async root => {
        const { markdown } = await render([
            embedded(root, 'secret.ts'),
            embedded(root, 'already-redacted.ts')
        ]);

        const secretTokens = treeTokenCountFor(markdown, 'secret.ts');
        const alreadyRedactedTokens = treeTokenCountFor(markdown, 'already-redacted.ts');

        // If the raw secret had been tokenized before Redaction ran, this
        // file's count would be far higher than already-redacted.ts's —
        // the 120-character run alone is many tokens on its own. Equal
        // counts are only possible if what was tokenized was the Redacted
        // text in both cases.
        assert.equal(secretTokens, alreadyRedactedTokens);

        // And the rendered content agrees with the tree's count: the marker
        // is what was actually written, not the secret.
        assert.equal(sectionFor(markdown, 'secret.ts'), sectionFor(markdown, 'already-redacted.ts'));
    });
});

test('a large adversarial file does not stall the Export', async () => {
    // Densely packed near-misses for every credential pattern at once: every
    // few characters is a prefix ('AKIA', 'ghp_', 'sk-', 'eyJ', a database
    // scheme) that almost, but does not quite, complete a match. None of the
    // patterns in redaction.ts nest a quantifier inside another or use
    // ambiguous alternation, so matching stays linear regardless — this is
    // the empirical half of that claim, not just the argument for it.
    const unit =
        'AKIA1234 ASIA5678 ghp_short gho_x ghu_x ghs_x ghr_x github_pat_short ' +
        'sk-ant-x sk-y pk_live_z pk_test_z sk_live_z sk_test_z rk_live_z rk_test_z ' +
        'eyJhbGciOiJIUzI1NiJ9.notquiteenough.short ' +
        'postgres://user mongodb://user mongodb+srv://user mysql://user redis://user ';
    const targetBytes = 5 * 1024 * 1024;
    const adversarial = unit.repeat(Math.ceil(targetBytes / unit.length));

    await withWorkspace({ 'adversarial.txt': adversarial }, async root => {
        const started = Date.now();
        const { statistics } = await render([embedded(root, 'adversarial.txt')]);
        const elapsedMs = Date.now() - started;

        // Measured in practice at well under a tenth of a second for input
        // this size and shape; two full seconds of budget is generous
        // headroom for a slower machine while still being far short of what
        // a catastrophic-backtracking pattern would cost (seconds do not
        // stay seconds for long once an engine starts backtracking
        // exponentially — it becomes minutes, then longer than anyone would
        // wait for a test to fail).
        assert.equal(elapsedMs < 2000, true, `took ${elapsedMs}ms`);
        // None of the near-misses actually completes a match.
        assert.equal(statistics.redactionCount, 0);
    });
});

test('a large adversarial .env file does not stall the Export either', async () => {
    // The dotenv path additionally splits the whole file on line endings,
    // which is its own place a pathological input could hide a cost — a
    // file that is millions of short assignment lines.
    const line = 'KEY_NAME_HERE=some_value_that_is_a_realistic_length_1234567890\n';
    const lineCount = 100_000;
    const adversarial = line.repeat(lineCount);

    await withWorkspace({ '.env': adversarial }, async root => {
        const started = Date.now();
        const { statistics } = await render([embedded(root, '.env')]);
        const elapsedMs = Date.now() - started;

        assert.equal(elapsedMs < 2000, true, `took ${elapsedMs}ms`);
        assert.equal(statistics.redactionCount, lineCount);
    });
});
