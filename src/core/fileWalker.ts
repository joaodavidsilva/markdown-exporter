import * as fs from 'fs';
import * as path from 'path';
import { shouldIgnoreFile } from './ignores';

export function walkFiles(inputPaths: string[], workspaceRoot: string): string[] {
    const allFiles: string[] = [];
    
    for (const inputPath of inputPaths) {
        if (!fs.existsSync(inputPath)) {
            continue;
        }
        
        if (fs.statSync(inputPath).isFile()) {
            if (!shouldIgnoreFile(inputPath, workspaceRoot)) {
                allFiles.push(inputPath);
            }
            continue;
        }
        
        const files = walkDirectory(inputPath, workspaceRoot);
        allFiles.push(...files);
    }
    
    return allFiles.sort();
}

function walkDirectory(dirPath: string, workspaceRoot: string): string[] {
    const files: string[] = [];
    
    function traverse(currentPath: string) {
        const items = fs.readdirSync(currentPath);
        
        for (const item of items) {
            const itemPath = path.join(currentPath, item);
            
            if (shouldIgnoreFile(itemPath, workspaceRoot)) {
                continue;
            }
            
            if (fs.statSync(itemPath).isDirectory()) {
                traverse(itemPath);
            } else {
                files.push(itemPath);
            }
        }
    }
    
    traverse(dirPath);
    return files;
}