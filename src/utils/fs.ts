import { workspaceResolver } from "@core/workspace"
import fs from "fs/promises"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"

// ---------------------------------------------------------------------------
// Virtual FileSystem (VFS) utilities
// ---------------------------------------------------------------------------
// These functions route file I/O to either the VS Code `workspace.fs` API
// (for virtual/non-file:// URIs) or to Node.js `fs/promises` (for regular
// filesystem paths).  The vscode module is loaded lazily so that this module
// continues to work in the CLI and unit-test environments where vscode is
// not available.
// ---------------------------------------------------------------------------

/** Cache the lazily-loaded vscode module (undefined = load attempted and failed). */
let _vscode: typeof import("vscode") | null | undefined

async function tryGetVscode(): Promise<typeof import("vscode") | null> {
	if (_vscode !== undefined) {
		return _vscode
	}
	try {
		// Dynamic import – works in VS Code extension context; throws in Node-only envs.
		_vscode = await import("vscode")
	} catch {
		_vscode = null
	}
	return _vscode
}

/**
 * Returns true when `filePath` uses a URI scheme other than "file://".
 * Virtual paths look like `scheme://...` (e.g. `vscode-remote://`, `ftp://`).
 * Regular filesystem paths (absolute or relative) return false.
 */
export function isVirtualPath(filePath: string): boolean {
	const match = filePath.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):\/\//)
	if (!match) {
		return false
	}
	return match[1].toLowerCase() !== "file"
}

/**
 * Converts a path string to a `vscode.Uri`.
 * Virtual paths are parsed directly; regular paths are converted via `Uri.file()`.
 * Throws if the vscode module is unavailable.
 */
export async function toUri(filePath: string): Promise<import("vscode").Uri> {
	const vscode = await tryGetVscode()
	if (!vscode) {
		throw new Error("VS Code API is not available in this environment")
	}
	return isVirtualPath(filePath) ? vscode.Uri.parse(filePath) : vscode.Uri.file(filePath)
}

/**
 * Reads a file and returns its raw bytes.
 * Routes to `vscode.workspace.fs.readFile` for virtual paths,
 * or to `fs.readFile` for regular filesystem paths.
 */
export async function vfsReadFile(filePath: string): Promise<Uint8Array> {
	if (isVirtualPath(filePath)) {
		const vscode = await tryGetVscode()
		if (!vscode) {
			throw new Error(`Cannot read virtual file without VS Code API: ${filePath}`)
		}
		return vscode.workspace.fs.readFile(vscode.Uri.parse(filePath))
	}
	return fs.readFile(filePath)
}

/**
 * Writes raw bytes to a file.
 * Routes to `vscode.workspace.fs.writeFile` for virtual paths,
 * or to `fs.writeFile` for regular filesystem paths.
 */
export async function vfsWriteFile(filePath: string, content: Uint8Array): Promise<void> {
	if (isVirtualPath(filePath)) {
		const vscode = await tryGetVscode()
		if (!vscode) {
			throw new Error(`Cannot write virtual file without VS Code API: ${filePath}`)
		}
		await vscode.workspace.fs.writeFile(vscode.Uri.parse(filePath), content)
		return
	}
	await fs.writeFile(filePath, content)
}

/**
 * Returns true if the path (real or virtual) exists.
 *
 * For virtual paths outside the VS Code extension context (e.g. CLI or tests),
 * this returns `false` because virtual files are only accessible through the
 * VS Code API.  Callers that need to distinguish "file not found" from "API
 * unavailable" should first call `isVirtualPath()` and handle accordingly.
 */
export async function vfsExists(filePath: string): Promise<boolean> {
	if (isVirtualPath(filePath)) {
		const vscode = await tryGetVscode()
		if (!vscode) {
			return false
		}
		try {
			await vscode.workspace.fs.stat(vscode.Uri.parse(filePath))
			return true
		} catch {
			return false
		}
	}
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

/**
 * Returns normalised stat information `{ mtime, size }` for a path.
 * `mtime` is always in milliseconds.
 */
export async function vfsStat(filePath: string): Promise<{ mtime: number; size: number }> {
	if (isVirtualPath(filePath)) {
		const vscode = await tryGetVscode()
		if (!vscode) {
			throw new Error(`Cannot stat virtual file without VS Code API: ${filePath}`)
		}
		const stat = await vscode.workspace.fs.stat(vscode.Uri.parse(filePath))
		return { mtime: stat.mtime, size: stat.size }
	}
	const stat = await fs.stat(filePath)
	return { mtime: stat.mtimeMs, size: stat.size }
}

/**
 * Deletes a file.
 * Routes to `vscode.workspace.fs.delete` for virtual paths,
 * or to `fs.rm` for regular filesystem paths.
 */
export async function vfsDelete(filePath: string): Promise<void> {
	if (isVirtualPath(filePath)) {
		const vscode = await tryGetVscode()
		if (!vscode) {
			throw new Error(`Cannot delete virtual file without VS Code API: ${filePath}`)
		}
		await vscode.workspace.fs.delete(vscode.Uri.parse(filePath))
		return
	}
	await fs.rm(filePath, { force: true })
}

const IS_WINDOWS = /^win/.test(process.platform)

/**
 * Asynchronously creates all non-existing subdirectories for a given file path
 * and collects them in an array for later deletion.
 *
 * @param filePath - The full path to a file.
 * @returns A promise that resolves to an array of newly created directories.
 */
export async function createDirectoriesForFile(filePath: string): Promise<string[]> {
	const newDirectories: string[] = []
	const normalizedFilePath = path.normalize(filePath) // Normalize path for cross-platform compatibility
	const directoryPath = path.dirname(normalizedFilePath)

	let currentPath = directoryPath
	const dirsToCreate: string[] = []

	// Traverse up the directory tree and collect missing directories
	while (!(await fileExistsAtPath(currentPath))) {
		dirsToCreate.push(currentPath)
		currentPath = path.dirname(currentPath)
	}

	// Create directories from the topmost missing one down to the target directory
	for (let i = dirsToCreate.length - 1; i >= 0; i--) {
		await fs.mkdir(dirsToCreate[i])
		newDirectories.push(dirsToCreate[i])
	}

	return newDirectories
}

/**
 * Helper function to check if a path exists.
 *
 * @param path - The path to check.
 * @returns A promise that resolves to true if the path exists, false otherwise.
 */
export async function fileExistsAtPath(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

/**
 * Checks if the path is a directory
 * @param filePath - The path to check.
 * @returns A promise that resolves to true if the path is a directory, false otherwise.
 */
export async function isDirectory(filePath: string): Promise<boolean> {
	try {
		const stats = await fs.stat(filePath)
		return stats.isDirectory()
	} catch {
		return false
	}
}

/**
 * Gets the size of a file in kilobytes
 * @param filePath - Path to the file to check
 * @returns Promise<number> - Size of the file in KB, or 0 if file doesn't exist
 */
export async function getFileSizeInKB(filePath: string): Promise<number> {
	try {
		const stats = await fs.stat(filePath)
		const fileSizeInKB = stats.size / 1000 // Convert bytes to KB (decimal) - matches OS file size display
		return fileSizeInKB
	} catch {
		return 0
	}
}

/**
 * Writes content to a file
 * @param filePath - Absolute path to the file
 * @param content - Content to write (string or Uint8Array)
 * @param encoding - Text encoding (default: 'utf8')
 * @returns A promise that resolves when the file is written
 */
export async function writeFile(
	filePath: string,
	content: string | Uint8Array,
	encoding: BufferEncoding = "utf8",
): Promise<void> {
	if (content instanceof Uint8Array) {
		await fs.writeFile(filePath, content)
	} else {
		await fs.writeFile(filePath, content, encoding)
	}
}

// Common OS-generated files that would appear in an otherwise clean directory
const OS_GENERATED_FILES = [
	".DS_Store", // macOS Finder
	"Thumbs.db", // Windows Explorer thumbnails
	"desktop.ini", // Windows folder settings
]

/**
 * Recursively reads a directory and returns an array of absolute file paths.
 *
 * @param directoryPath - The path to the directory to read.
 * @param excludedPaths - Nested array of paths to ignore.
 * @returns A promise that resolves to an array of absolute file paths.
 * @throws Error if the directory cannot be read.
 */
export const readDirectory = async (directoryPath: string, excludedPaths: string[][] = []) => {
	try {
		const filePaths = await fs
			.readdir(directoryPath, { withFileTypes: true, recursive: true })
			.then((entries) => entries.filter((entry) => !OS_GENERATED_FILES.includes(entry.name)))
			.then((entries) => entries.filter((entry) => entry.isFile()))
			.then((files) =>
				files.map((file) => {
					const resolvedPath = workspaceResolver.resolveWorkspacePath(
						file.parentPath,
						file.name,
						"Utils.fs.readDirectory",
					)
					return typeof resolvedPath === "string" ? resolvedPath : resolvedPath.absolutePath
				}),
			)
			.then((filePaths) =>
				filePaths.filter((filePath) => {
					if (excludedPaths.length === 0) {
						return true
					}

					for (const excludedPathList of excludedPaths) {
						const pathToSearchFor = path.sep + excludedPathList.join(path.sep) + path.sep
						if (filePath.includes(pathToSearchFor)) {
							return false
						}
					}

					return true
				}),
			)

		return filePaths
	} catch {
		throw new Error(`Error reading directory at ${directoryPath}`)
	}
}

export async function getBinaryLocation(name: string): Promise<string> {
	const binName = IS_WINDOWS ? `${name}.exe` : name
	const location = await HostProvider.get().getBinaryLocation(binName)

	if (!(await fileExistsAtPath(location))) {
		throw new Error(`Could not find binary ${name} at: ${location}`)
	}
	return location
}
