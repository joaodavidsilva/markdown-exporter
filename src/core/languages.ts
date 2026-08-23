import * as path from 'node:path';

/**
 * The fence's language hint for a file.
 *
 * Two questions, in this order: does the whole file name have a well-known
 * identity, and failing that, does the extension? The name comes first because
 * the files that have one — `Dockerfile`, `Makefile`, `Gemfile` — mostly have
 * no extension at all, and the few that do (`CMakeLists.txt`) are better
 * described by their name than by it.
 *
 * When neither question has an answer the hint is empty. A wrong hint is worse
 * than none: it tells a reader, and a model, something untrue about the file,
 * whereas an absent one only declines to say. That is why extensions carrying
 * more than one language — `.m` is Objective-C, MATLAB and Mathematica — are
 * deliberately absent from the map rather than resolved by a guess.
 */
export function languageHintFor(filePath: string): string {
    const fileName = path.basename(filePath);

    const byName = languageForFileName(fileName);
    if (byName) {
        return byName;
    }

    const extension = path.extname(fileName).toLowerCase().slice(1);
    return extensionLanguages[extension] ?? '';
}

/**
 * The identity a file name carries on its own, for the files where the name is
 * the convention and an extension would be beside the point.
 */
function languageForFileName(fileName: string): string {
    const name = fileName.toLowerCase();

    const exact = fileNameLanguages[name];
    if (exact) {
        return exact;
    }

    // The two families whose members are named rather than enumerated: an
    // environment file per deployment (`.env.production`) and a Dockerfile per
    // image (`Dockerfile.builder`, `api.Dockerfile`).
    if (name.startsWith('.env.')) {
        return 'dotenv';
    }
    if (name.startsWith('dockerfile.') || name.endsWith('.dockerfile')) {
        return 'dockerfile';
    }

    return '';
}

const extensionLanguages: Record<string, string> = {
    // JavaScript and TypeScript, including the module-flavoured extensions
    // that a package with dual builds is full of.
    'js': 'javascript',
    'jsx': 'javascript',
    'mjs': 'javascript',
    'cjs': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'mts': 'typescript',
    'cts': 'typescript',
    'coffee': 'coffeescript',

    // C family.
    'c': 'c',
    'h': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'cxx': 'cpp',
    'hpp': 'cpp',
    'hh': 'cpp',
    'hxx': 'cpp',
    'cs': 'csharp',
    'fs': 'fsharp',
    'fsx': 'fsharp',
    'vb': 'vbnet',

    // Everything else with an unambiguous extension.
    'py': 'python',
    'pyi': 'python',
    'java': 'java',
    'kt': 'kotlin',
    'kts': 'kotlin',
    'scala': 'scala',
    'sbt': 'scala',
    'groovy': 'groovy',
    'gradle': 'groovy',
    'php': 'php',
    'rb': 'ruby',
    'rake': 'ruby',
    'gemspec': 'ruby',
    'erb': 'erb',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'dart': 'dart',
    'lua': 'lua',
    'pl': 'perl',
    'pm': 'perl',
    'r': 'r',
    'jl': 'julia',
    'ex': 'elixir',
    'exs': 'elixir',
    'erl': 'erlang',
    'hrl': 'erlang',
    'hs': 'haskell',
    'elm': 'elm',
    'clj': 'clojure',
    'cljs': 'clojure',
    'cljc': 'clojure',
    'edn': 'clojure',
    'ml': 'ocaml',
    'mli': 'ocaml',
    'nix': 'nix',
    'zig': 'zig',
    'sol': 'solidity',
    'f90': 'fortran',
    'f95': 'fortran',
    'pas': 'pascal',
    'vim': 'vim',
    'awk': 'awk',
    'applescript': 'applescript',

    // Shells and scripting.
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'fish': 'fish',
    'ps1': 'powershell',
    'psm1': 'powershell',
    'psd1': 'powershell',
    'bat': 'batch',
    'cmd': 'batch',

    // Markup and styling.
    'html': 'html',
    'htm': 'html',
    'xhtml': 'html',
    'xml': 'xml',
    'xsl': 'xml',
    'xslt': 'xml',
    'svg': 'xml',
    'plist': 'xml',
    'csproj': 'xml',
    'vbproj': 'xml',
    'vcxproj': 'xml',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'styl': 'stylus',
    'pug': 'pug',
    'jade': 'pug',
    'hbs': 'handlebars',
    'handlebars': 'handlebars',
    'mustache': 'mustache',
    'ejs': 'ejs',
    'vue': 'vue',
    'svelte': 'svelte',
    'astro': 'astro',

    // Data, configuration and schema.
    'json': 'json',
    'jsonc': 'jsonc',
    'json5': 'json5',
    'ipynb': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'ini': 'ini',
    'cfg': 'ini',
    'conf': 'ini',
    'properties': 'properties',
    'sql': 'sql',
    'graphql': 'graphql',
    'gql': 'graphql',
    'proto': 'protobuf',
    'prisma': 'prisma',
    'tf': 'hcl',
    'tfvars': 'hcl',
    'hcl': 'hcl',
    'bicep': 'bicep',
    'cmake': 'cmake',
    'mk': 'makefile',

    // Prose and patches.
    'md': 'markdown',
    'markdown': 'markdown',
    'mdx': 'mdx',
    'rst': 'restructuredtext',
    'adoc': 'asciidoc',
    'asciidoc': 'asciidoc',
    'tex': 'latex',
    'diff': 'diff',
    'patch': 'diff',

    // Files named after the tool that reads them, given an extension.
    'dockerfile': 'dockerfile'
};

/**
 * Keys are lower-cased: `Makefile` and `makefile` are the same file to
 * everyone but the filesystem.
 */
const fileNameLanguages: Record<string, string> = {
    // Build and task definitions.
    'dockerfile': 'dockerfile',
    'containerfile': 'dockerfile',
    'makefile': 'makefile',
    'gnumakefile': 'makefile',
    'cmakelists.txt': 'cmake',
    'jenkinsfile': 'groovy',
    'gemfile': 'ruby',
    'rakefile': 'ruby',
    'podfile': 'ruby',
    'fastfile': 'ruby',
    'appfile': 'ruby',
    'brewfile': 'ruby',
    'vagrantfile': 'ruby',
    'guardfile': 'ruby',
    'capfile': 'ruby',
    'thorfile': 'ruby',
    'pipfile': 'toml',

    // Exclusion lists, which share `.gitignore` syntax wherever they appear.
    '.gitignore': 'gitignore',
    '.gitattributes': 'gitattributes',
    '.dockerignore': 'gitignore',
    '.npmignore': 'gitignore',
    '.eslintignore': 'gitignore',
    '.prettierignore': 'gitignore',
    '.exportignore': 'gitignore',

    // Shell startup files.
    '.bashrc': 'bash',
    '.bash_profile': 'bash',
    '.bash_aliases': 'bash',
    '.zshrc': 'bash',
    '.zprofile': 'bash',
    '.profile': 'bash',

    // Editor and tool configuration written without an extension.
    '.editorconfig': 'ini',
    '.gitconfig': 'ini',
    '.gitmodules': 'ini',
    '.npmrc': 'ini',
    '.yarnrc': 'ini',
    '.babelrc': 'json',
    '.eslintrc': 'json',
    '.prettierrc': 'json',
    '.stylelintrc': 'json',
    '.env': 'dotenv',
    '.htaccess': 'apache'
};
