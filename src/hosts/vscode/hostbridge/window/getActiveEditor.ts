import * as vscode from "vscode"

import { GetActiveEditorRequest, GetActiveEditorResponse } from "@/shared/proto/index.host"

export async function getActiveEditor(_: GetActiveEditorRequest): Promise<GetActiveEditorResponse> {
	const document = vscode.window.activeTextEditor?.document
	if (!document) {
		return {}
	}
	const uri = document.uri
	// For virtual filesystems (non-file:// schemes), return the full URI string
	// so callers can detect the scheme and display or resolve it correctly.
	// For regular file:// URIs, return the filesystem path to preserve
	// backward compatibility with callers that expect a plain path.
	const filePath = uri.scheme === "file" ? uri.fsPath : uri.toString()
	return { filePath }
}
