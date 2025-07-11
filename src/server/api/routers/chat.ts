import { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { generateCode, generateChatResponse } from "~/server/services/claude";
import { 
  applyGeneratedFiles, 
  listProjectFiles, 
  readProjectFiles,
  isPathSafe 
} from "~/server/services/fileManager";
import { updateBuildProgress } from "../routers/appStarter";

export const chatRouter = createTRPCRouter({
  sendMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        message: z.string().min(1),
      }),
    )
    .mutation(async ({ input }) => {
      const { sessionId, message } = input;
      const projectDir = join(tmpdir(), `expo-${sessionId}`);

      try {
        // Update progress to show AI is thinking
        updateBuildProgress(sessionId, {
          type: "ai-thinking",
          stage: "AI Processing",
          message: "Claude is analyzing your request...",
        });

        // Check if this is a code generation request
        const codeKeywords = [
          "add", "create", "implement", "build", "make",
          "change", "update", "modify", "edit",
          "delete", "remove", "fix", "style",
          "component", "screen", "feature", "navigation"
        ];
        
        const isCodeRequest = codeKeywords.some(keyword => 
          message.toLowerCase().includes(keyword)
        );

        if (isCodeRequest) {
          // Get current project files
          const projectFiles = await listProjectFiles(projectDir);
          const existingCode = await readProjectFiles(projectDir, 
            projectFiles.slice(0, 10) // Limit to avoid token limits
          );

          // Generate code with Claude
          const codeResponse = await generateCode({
            userMessage: message,
            projectDir,
            sessionId,
            context: {
              currentFiles: projectFiles,
              projectType: "expo",
              existingCode,
            },
          });

          if (codeResponse.error) {
            return {
              response: `I encountered an error: ${codeResponse.error}. Please try rephrasing your request.`,
              sessionId,
            };
          }

          // Validate file paths for security
          for (const file of codeResponse.files) {
            if (!isPathSafe(projectDir, file.path)) {
              return {
                response: "Security error: Invalid file path detected. Please try a different request.",
                sessionId,
              };
            }
          }

          // Update progress to show we're applying changes
          updateBuildProgress(sessionId, {
            type: "ai-applying",
            stage: "Applying Changes",
            message: `Updating ${codeResponse.files.length} file(s)...`,
          });

          // Apply the generated files
          const results = await applyGeneratedFiles(projectDir, codeResponse.files);
          
          // Check for any errors
          const errors = results.filter(r => !r.success);
          if (errors.length > 0) {
            const errorMessages = errors.map(e => `${e.path}: ${e.error}`).join(", ");
            return {
              response: `I generated the code but encountered errors applying it: ${errorMessages}`,
              sessionId,
            };
          }

          // Build response message
          const filesList = codeResponse.files
            .map(f => `• ${f.action === "create" ? "Created" : f.action === "update" ? "Updated" : "Deleted"} ${f.path}`)
            .join("\n");

          const response = `${codeResponse.explanation}\n\nFiles modified:\n${filesList}\n\nThe changes have been applied to your Expo app. You should see the updates in Expo Go shortly!`;

          // Update progress to show completion
          updateBuildProgress(sessionId, {
            type: "ai-complete",
            stage: "Changes Applied",
            message: "Your code has been updated successfully!",
          });

          return {
            response,
            sessionId,
          };
        } else {
          // For non-code requests, use the chat response
          const response = await generateChatResponse(message);
          return {
            response,
            sessionId,
          };
        }
      } catch (error) {
        console.error("Chat error:", error);
        return {
          response: "I apologize, but I encountered an error processing your request. Please try again.",
          sessionId,
        };
      }
    }),
});

// Export the updateBuildProgress function for use in this module
export { updateBuildProgress } from "../routers/appStarter";