import * as fs from 'fs';
import * as path from 'path';
import { getConfiguration } from '../config/settings';
import { isBinaryFile } from './binaryDetection';

export async function buildMarkdown(files: string[], workspaceRoot: string, outputFileName?: string): Promise<string> {
    const config = getConfiguration();
    const finalName = outputFileName || config.outputFile;
    const outputPath = path.join(workspaceRoot, finalName);

    let markdown = '# Project Code Export\n\n';
    markdown += '## Index\n\n';

    for (const file of files) {
        const relativePath = path.relative(workspaceRoot, file);
        markdown += `- [${relativePath}](#${relativePath.replace(/[/\\.]/g, '-')})\n`;
    }

    markdown += '\n---\n\n';

    for (const file of files) {
        const relativePath = path.relative(workspaceRoot, file);
        markdown += `## ${relativePath}\n\n`;

        if (isBinaryFile(file, config.binaryFileExtensions)) {
            markdown += 'This is a binary or unsupported file type. Content not included.\n\n';
        } else {
            try {
                const content = fs.readFileSync(file, 'utf8');
                const ext = path.extname(file).toLowerCase().slice(1);
                const lang = getLanguageFromExtension(ext);
                markdown += `\`\`\`${lang}\n${content}\n\`\`\`\n\n`;
            } catch {
                markdown += 'Error reading file content.\n\n';
            }
        }

        markdown += '---\n\n';
    }

    fs.writeFileSync(outputPath, markdown, 'utf8');
    return finalName;
}

function getLanguageFromExtension(ext: string): string {
    const languageMap: { [key: string]: string } = {
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

    return languageMap[ext] || '';
}