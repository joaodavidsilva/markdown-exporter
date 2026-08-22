import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

export function createGitignoreFilter(workspaceRoot: string) {
    const gitignorePath = path.join(workspaceRoot, '.gitignore');
    
    if (!fs.existsSync(gitignorePath)) {
        return () => false;
    }

    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const ig = ignore().add(gitignoreContent);
    
    return (filePath: string) => {
        const relativePath = path.relative(workspaceRoot, filePath);
        return ig.ignores(relativePath);
    };
}