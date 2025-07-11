import { promises as fs } from "node:fs";
import path from "node:path";
import type { GeneratedFile } from "./claude";

export interface FileOperationResult {
  success: boolean;
  path: string;
  error?: string;
}

/**
 * Apply generated files to the project directory
 */
export async function applyGeneratedFiles(
  projectDir: string,
  files: GeneratedFile[]
): Promise<FileOperationResult[]> {
  const results: FileOperationResult[] = [];

  for (const file of files) {
    try {
      const fullPath = path.join(projectDir, file.path);
      
      // Ensure the directory exists
      const dirPath = path.dirname(fullPath);
      await fs.mkdir(dirPath, { recursive: true });

      switch (file.action) {
        case "create":
        case "update":
          // Write the file content
          await fs.writeFile(fullPath, file.content, "utf-8");
          results.push({
            success: true,
            path: file.path,
          });
          break;

        case "delete":
          // Delete the file if it exists
          try {
            await fs.unlink(fullPath);
            results.push({
              success: true,
              path: file.path,
            });
          } catch (error) {
            // If file doesn't exist, that's okay
            if ((error as any).code === "ENOENT") {
              results.push({
                success: true,
                path: file.path,
              });
            } else {
              throw error;
            }
          }
          break;
      }
    } catch (error) {
      results.push({
        success: false,
        path: file.path,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}

/**
 * Read existing files from the project directory
 */
export async function readProjectFiles(
  projectDir: string,
  filePaths: string[]
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};

  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(projectDir, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      files[filePath] = content;
    } catch (error) {
      // If file doesn't exist or can't be read, skip it
      console.warn(`Could not read file ${filePath}:`, error);
    }
  }

  return files;
}

/**
 * Get list of files in the project directory
 */
export async function listProjectFiles(
  projectDir: string,
  extensions: string[] = [".js", ".jsx", ".ts", ".tsx", ".json"]
): Promise<string[]> {
  const files: string[] = [];

  async function scanDirectory(dir: string) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
            await scanDirectory(fullPath);
          }
        } else if (entry.isFile()) {
          // Check if file has one of the desired extensions
          const ext = path.extname(entry.name);
          if (extensions.includes(ext)) {
            // Get relative path from project root
            const relativePath = path.relative(projectDir, fullPath);
            files.push(relativePath);
          }
        }
      }
    } catch (error) {
      console.warn(`Could not scan directory ${dir}:`, error);
    }
  }

  await scanDirectory(projectDir);
  return files;
}

/**
 * Validate that file operations are within the project directory
 */
export function isPathSafe(projectDir: string, filePath: string): boolean {
  const resolvedPath = path.resolve(projectDir, filePath);
  const resolvedProjectDir = path.resolve(projectDir);
  
  // Ensure the resolved path is within the project directory
  return resolvedPath.startsWith(resolvedProjectDir);
}

/**
 * Create a backup of files before modifying them
 */
export async function backupFiles(
  projectDir: string,
  filePaths: string[]
): Promise<Map<string, string>> {
  const backups = new Map<string, string>();

  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(projectDir, filePath);
      const content = await fs.readFile(fullPath, "utf-8");
      backups.set(filePath, content);
    } catch (error) {
      // File doesn't exist yet, no need to backup
    }
  }

  return backups;
}

/**
 * Restore files from backup
 */
export async function restoreFiles(
  projectDir: string,
  backups: Map<string, string>
): Promise<void> {
  for (const [filePath, content] of backups) {
    const fullPath = path.join(projectDir, filePath);
    await fs.writeFile(fullPath, content, "utf-8");
  }
}