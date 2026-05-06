import { Anthropic } from "@anthropic-ai/sdk"
import { isVirtualPath, vfsExists, vfsReadFile } from "@utils/fs"
import * as path from "path"
import { extractImageContent } from "./extract-images"
import { callTextExtractionFunctions } from "./extract-text"

export type FileContentResult = {
	text: string
	imageBlock?: Anthropic.ImageBlockParam
}

/**
 * Extract content from a file, handling both text and images
 * Extra logic for handling images based on whether the model supports images
 */
export async function extractFileContent(absolutePath: string, modelSupportsImages: boolean): Promise<FileContentResult> {
	// Check if file exists first
	if (!(await vfsExists(absolutePath))) {
		throw new Error(`File not found: ${absolutePath}`)
	}

	const fileExtension = path.extname(absolutePath).toLowerCase()
	const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
	const isImage = imageExtensions.includes(fileExtension)

	// For virtual paths, route through the VS Code workspace.fs API.
	// Special file types (PDF, DOCX, images, etc.) are not yet supported for
	// virtual filesystems – only plain text is handled.
	if (isVirtualPath(absolutePath)) {
		if (isImage) {
			if (modelSupportsImages) {
				throw new Error(`Image reading from virtual filesystems is not yet supported`)
			}
			throw new Error(`Current model does not support image input`)
		}
		try {
			const buffer = await vfsReadFile(absolutePath)
			const textContent = new TextDecoder().decode(buffer)
			return { text: textContent }
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error"
			throw new Error(`Error reading file: ${errorMessage}`)
		}
	}

	if (isImage && modelSupportsImages) {
		const imageResult = await extractImageContent(absolutePath)

		if (imageResult.success) {
			return {
				text: "Successfully read image",
				imageBlock: imageResult.imageBlock,
			}
		}
		throw new Error(imageResult.error)
	}
	if (isImage && !modelSupportsImages) {
		throw new Error(`Current model does not support image input`)
	}
	// Handle text files using existing extraction functions
	try {
		const textContent = await callTextExtractionFunctions(absolutePath)
		return {
			text: textContent,
		}
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown error"
		throw new Error(`Error reading file: ${errorMessage}`)
	}
}
