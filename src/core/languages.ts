import * as path from 'node:path';

/**
 * The fence's language hint for a file. Deliberately empty rather than
 * guessing when the extension is unknown: a wrong hint is worse than none.
 */
export function languageHintFor(filePath: string): string {
    const extension = path.extname(filePath).toLowerCase().slice(1);
    return languageMap[extension] || '';
}

const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'cxx': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'go': 'go',
    'rs': 'rust',
    'swift': 'swift',
    'kt': 'kotlin',
    'scala': 'scala',
    'sh': 'bash',
    'bash': 'bash',
    'zsh': 'bash',
    'fish': 'fish',
    'ps1': 'powershell',
    'bat': 'batch',
    'cmd': 'batch',
    'html': 'html',
    'htm': 'html',
    'xml': 'xml',
    'css': 'css',
    'scss': 'scss',
    'sass': 'sass',
    'less': 'less',
    'json': 'json',
    'yaml': 'yaml',
    'yml': 'yaml',
    'toml': 'toml',
    'ini': 'ini',
    'conf': 'ini',
    'sql': 'sql',
    'md': 'markdown',
    'markdown': 'markdown',
    'tex': 'latex',
    'dockerfile': 'dockerfile',
    'vue': 'vue',
    'svelte': 'svelte'
};