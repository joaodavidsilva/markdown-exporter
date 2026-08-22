"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSelectionPaths = getSelectionPaths;
function getSelectionPaths(uri, uris, workspaceRoot) {
    if (uris && uris.length > 0) {
        return uris.map(function (u) { return u.fsPath; });
    }
    if (uri) {
        return [uri.fsPath];
    }
    return [workspaceRoot];
}
