"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBinaryFile = isBinaryFile;
var path = require("path");
function isBinaryFile(filePath, binaryExtensions) {
    var ext = path.extname(filePath).toLowerCase().slice(1);
    return binaryExtensions.includes(ext);
}
