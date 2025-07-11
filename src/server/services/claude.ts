import Anthropic from "@anthropic-ai/sdk";
import { env } from "~/env";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
});

export interface CodeGenerationRequest {
  userMessage: string;
  projectDir: string;
  sessionId: string;
  context?: {
    currentFiles?: string[];
    projectType?: "expo" | "react-native";
    existingCode?: Record<string, string>;
  };
}

export interface GeneratedFile {
  path: string;
  content: string;
  action: "create" | "update" | "delete";
}

export interface CodeGenerationResponse {
  files: GeneratedFile[];
  explanation: string;
  error?: string;
}

/**
 * Generate code based on user's natural language request
 */
export async function generateCode(
  request: CodeGenerationRequest,
  retries = 2
): Promise<CodeGenerationResponse> {
  try {
    const { userMessage, projectDir, context } = request;

    // Build a comprehensive prompt for Claude
    const systemPrompt = `You are an expert React Native/Expo developer assistant. Your task is to generate or modify code based on user requests.

IMPORTANT RULES:
1. Generate complete, working React Native/Expo code
2. Use Expo SDK 53.0.0 compatible code
3. Include all necessary imports
4. Follow React Native and JavaScript best practices
5. Return your response in a specific JSON format

Context:
- Project directory: ${projectDir}
- Project type: ${context?.projectType || "expo"}
${
  context?.currentFiles
    ? `- Existing files: ${context.currentFiles.join(", ")}`
    : ""
}

RESPONSE FORMAT:
You must respond with a JSON object in this exact format:
{
  "files": [
    {
      "path": "relative/path/to/file.js",
      "content": "// Complete file content here",
      "action": "create" // or "update" or "delete"
    }
  ],
  "explanation": "Brief explanation of what was done"
}

IMPORTANT: Your entire response must be valid JSON. Do not include any text outside the JSON object.`;

    const userPrompt = `User request: "${userMessage}"

${
  context?.existingCode
    ? `\nExisting code files:\n${Object.entries(context.existingCode)
        .map(([path, content]) => `\n--- ${path} ---\n${content}`)
        .join("\n")}`
    : ""
}

Generate the necessary code changes to fulfill this request. Remember to respond with valid JSON only.`;

    // Call Claude API
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 8192,
      temperature: 0.2,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    });

    // Extract the text content from the response
    const textContent = response.content[0];
    if (!textContent || textContent.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    // Parse the JSON response
    try {
      const parsedResponse = JSON.parse(textContent.text);
      
      // Validate the response structure
      if (!parsedResponse.files || !Array.isArray(parsedResponse.files)) {
        throw new Error("Invalid response format: missing files array");
      }

      return {
        files: parsedResponse.files,
        explanation: parsedResponse.explanation || "Code generated successfully",
      };
    } catch (parseError) {
      console.error("Failed to parse Claude response:", textContent.text);
      throw new Error(`Failed to parse AI response: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
    }
  } catch (error) {
    console.error("Claude API error:", error);
    
    // Handle rate limiting and overloaded errors
    if (error instanceof Anthropic.APIError && (error.status === 429 || error.status === 529) && retries > 0) {
      const waitTime = error.status === 529 ? 10000 : 5000; // Wait longer for overloaded errors
      console.log(`${error.status === 529 ? 'Service overloaded' : 'Rate limited'}, retrying in ${waitTime/1000} seconds... (${retries} retries left)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return generateCode(request, retries - 1);
    }
    
    // Handle other API errors
    let errorMessage = "Failed to generate code";
    if (error instanceof Anthropic.APIError) {
      switch (error.status) {
        case 401:
          errorMessage = "Invalid API key. Please check your Claude API configuration.";
          break;
        case 403:
          errorMessage = "API access forbidden. Please check your API key permissions.";
          break;
        case 500:
        case 502:
        case 503:
        case 529:
          errorMessage = "Claude API is temporarily overloaded. Please try again in a moment.";
          break;
        default:
          errorMessage = `Claude API error: ${error.message}`;
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    return {
      files: [],
      explanation: "Failed to generate code",
      error: errorMessage,
    };
  }
}

/**
 * Generate a simple AI response for chat messages (non-code generation)
 */
export async function generateChatResponse(message: string, retries = 1): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      temperature: 0.7,
      system: "You are a helpful AI assistant for a mobile app development platform. Help users understand how to build their Expo/React Native apps. Be concise and friendly.",
      messages: [
        {
          role: "user",
          content: message,
        },
      ],
    });

    const textContent = response.content[0];
    if (!textContent || textContent.type !== "text") {
      throw new Error("Unexpected response type from Claude");
    }

    return textContent.text;
  } catch (error) {
    console.error("Claude chat error:", error);
    
    // Handle rate limiting and overloaded errors with retry
    if (error instanceof Anthropic.APIError && (error.status === 429 || error.status === 529) && retries > 0) {
      const waitTime = error.status === 529 ? 8000 : 3000; // Wait longer for overloaded errors
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return generateChatResponse(message, retries - 1);
    }
    
    // Provide specific error messages
    if (error instanceof Anthropic.APIError) {
      switch (error.status) {
        case 401:
          return "I'm having authentication issues. Please check the API configuration.";
        case 403:
          return "I don't have permission to access the AI service. Please check the API settings.";
        case 500:
        case 502:
        case 503:
        case 529:
          return "The AI service is temporarily overloaded. Please try again in a moment.";
      }
    }
    
    return "I apologize, but I'm having trouble processing your request right now. Please try again.";
  }
}

/**
 * Generate initial app structure based on user's description
 */
export async function generateInitialApp(
  appDescription: string,
  projectName: string
): Promise<GeneratedFile[]> {
  const request: CodeGenerationRequest = {
    userMessage: `Create a new Expo app with the following description: ${appDescription}. The app should be named "${projectName}". Generate the initial App.js file and any necessary components to get started.`,
    projectDir: `/tmp/expo-app`,
    sessionId: "initial",
    context: {
      projectType: "expo",
    },
  };

  const response = await generateCode(request);
  return response.files;
}