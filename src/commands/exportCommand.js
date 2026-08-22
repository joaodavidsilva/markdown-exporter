"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportCommand = exportCommand;
var vscode = require("vscode");
var paths_1 = require("../core/paths");
var selection_1 = require("../core/selection");
var fileWalker_1 = require("../core/fileWalker");
var markdownBuilder_1 = require("../core/markdownBuilder");
var settings_1 = require("../config/settings");
function exportCommand(uri, uris) {
    return __awaiter(this, void 0, void 0, function () {
        var workspaceRoot_1, selectionPaths_1, error_1, message;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    workspaceRoot_1 = (0, paths_1.getWorkspaceRoot)();
                    if (!workspaceRoot_1) {
                        vscode.window.showErrorMessage('No workspace folder found');
                        return [2 /*return*/];
                    }
                    selectionPaths_1 = (0, selection_1.getSelectionPaths)(uri, uris, workspaceRoot_1);
                    if (selectionPaths_1.length === 0) {
                        vscode.window.showWarningMessage('No files or folders selected');
                        return [2 /*return*/];
                    }
                    var config = (0, settings_1.getConfiguration)();
                    var timestampedFileName = (0, markdownBuilder_1.generateTimestampedFileName)(config.outputFile);
                    var outputFilePath = require("path").join(workspaceRoot_1, timestampedFileName);
                    return [4 /*yield*/, vscode.window.withProgress({
                            location: vscode.ProgressLocation.Notification,
                            title: 'Exporting to Markdown',
                            cancellable: false
                        }, function (progress) { return __awaiter(_this, void 0, void 0, function () {
                            var allFiles;
                            return __generator(this, function (_a) {
                                switch (_a.label) {
                                    case 0:
                                        progress.report({ increment: 0, message: 'Scanning files...' });
                                        allFiles = (0, fileWalker_1.walkFiles)(selectionPaths_1, workspaceRoot_1, outputFilePath);
                                        progress.report({ increment: 50, message: 'Building markdown...' });
                                        return [4 /*yield*/, (0, markdownBuilder_1.buildMarkdown)(allFiles, workspaceRoot_1)];
                                    case 1:
                                        _a.sent();
                                        progress.report({ increment: 100, message: 'Done!' });
                                        return [2 /*return*/];
                                }
                            });
                        }); })];
                case 1:
                    _a.sent();
                    vscode.window.showInformationMessage('Export completed successfully!');
                    return [3 /*break*/, 3];
                case 2:
                    error_1 = _a.sent();
                    message = error_1 instanceof Error ? error_1.message : 'Unknown error occurred';
                    vscode.window.showErrorMessage("Export failed: ".concat(message));
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
