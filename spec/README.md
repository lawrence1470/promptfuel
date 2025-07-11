# LLM Prompt & Spec Directory for Next.js App Generation

This directory contains the specifications and templates for generating beautiful, production-ready Next.js applications from user prompts.

## 📁 Directory Structure

- **`prompts/`** - Prompt templates for LLMs (Claude, GPT, etc.)
- **`schemas/`** - JSON Schema files for input/output validation
- **`tests/`** - Test cases for prompt regression testing
- **`README.md`** - This file

## 🎨 Design Principles

The prompt templates emphasize:

- **Modern aesthetics** inspired by Vercel.com and Linear.app
- **Responsive design** that works on all devices
- **Accessibility** (WCAG AA compliance)
- **Component reusability** with shared UI elements
- **Production-ready code** with TypeScript and Tailwind CSS

## 🔧 How to Use

1. **Update prompts** in `prompts/` as you iterate on your LLM instructions
2. **Validate inputs/outputs** against the JSON schemas in `schemas/`
3. **Add test cases** in `tests/` to prevent regressions when changing prompts
4. **Version control** your prompt engineering process

## 📋 Technical Requirements

Generated Next.js apps include:

- TypeScript throughout
- App Router structure
- Tailwind CSS for styling
- Reusable components
- Proper accessibility features
- Complete package.json with dependencies

## 🧪 Testing

Run tests to ensure your prompts generate the expected outputs:

- Input validation against `build_nextjs_app.input.schema.json`
- Output validation against `build_nextjs_app.output.schema.json`
- Regression testing with examples in `tests/`

## 🚀 Future Enhancements

Consider adding:

- More specific prompt variants (e.g., e-commerce, blog, dashboard)
- Additional output formats (TypeScript interfaces, API routes)
- Performance and SEO optimization rules
- Integration with design systems
