/**
 * Orion CLI - Project Scaffolding Command
 * Creates new projects from templates with AI customization.
 *
 * Usage:
 *   orion scaffold                         # Interactive project creation wizard
 *   orion scaffold react my-app            # Create React project
 *   orion scaffold next my-app             # Create Next.js project
 *   orion scaffold express my-api          # Create Express API
 *   orion scaffold --list                  # List available templates
 */

import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import { askAI } from '../ai-client.js';
import {
  colors,
  printInfo,
  printSuccess,
  printError,
  printWarning,
  startSpinner,
  stopSpinner,
  writeFileContent,
  loadProjectContext,
} from '../utils.js';
import {
  createSilentStreamHandler,
} from '../shared.js';
import { getPipelineOptions, jsonOutput } from '../pipeline.js';
import {
  commandHeader,
  table as uiTable,
  divider,
  palette,
  badge,
} from '../ui.js';

// ─── Template Definitions ─────────────────────────────────────────────────

interface TemplateDefinition {
  label: string;
  description: string;
  language: string;
  category: 'frontend' | 'backend' | 'fullstack';
  features: string[];
}

const TEMPLATES: Record<string, TemplateDefinition> = {
  react: {
    label: 'React',
    description: 'React 18 SPA with Vite, React Router, and modern tooling',
    language: 'typescript',
    category: 'frontend',
    features: ['vite', 'react-router', 'tailwindcss'],
  },
  next: {
    label: 'Next.js',
    description: 'Next.js 14 App Router with SSR/SSG and API routes',
    language: 'typescript',
    category: 'fullstack',
    features: ['app-router', 'ssr', 'api-routes', 'tailwindcss'],
  },
  vue: {
    label: 'Vue 3',
    description: 'Vue 3 with Vite, Composition API, and Pinia state management',
    language: 'typescript',
    category: 'frontend',
    features: ['vite', 'composition-api', 'pinia', 'vue-router'],
  },
  svelte: {
    label: 'SvelteKit',
    description: 'SvelteKit with server-side rendering and file-based routing',
    language: 'typescript',
    category: 'fullstack',
    features: ['ssr', 'file-routing', 'vite'],
  },
  express: {
    label: 'Express',
    description: 'Express.js REST API with middleware, validation, and error handling',
    language: 'typescript',
    category: 'backend',
    features: ['rest-api', 'middleware', 'cors', 'helmet'],
  },
  fastify: {
    label: 'Fastify',
    description: 'Fastify API with schema validation, plugins, and Swagger docs',
    language: 'typescript',
    category: 'backend',
    features: ['schema-validation', 'plugins', 'swagger'],
  },
  nestjs: {
    label: 'NestJS',
    description: 'NestJS enterprise framework with modules, guards, and decorators',
    language: 'typescript',
    category: 'backend',
    features: ['modules', 'guards', 'pipes', 'swagger'],
  },
  'python-flask': {
    label: 'Python Flask',
    description: 'Flask REST API with blueprints, SQLAlchemy, and marshmallow',
    language: 'python',
    category: 'backend',
    features: ['blueprints', 'sqlalchemy', 'marshmallow'],
  },
  'python-fastapi': {
    label: 'Python FastAPI',
    description: 'FastAPI with async support, Pydantic models, and auto-docs',
    language: 'python',
    category: 'backend',
    features: ['async', 'pydantic', 'openapi', 'uvicorn'],
  },
  'go-gin': {
    label: 'Go Gin',
    description: 'Go web API with Gin framework, middleware, and structured logging',
    language: 'go',
    category: 'backend',
    features: ['gin', 'middleware', 'structured-logging'],
  },
  'rust-axum': {
    label: 'Rust Axum',
    description: 'Rust web API with Axum, Tokio async runtime, and Tower middleware',
    language: 'rust',
    category: 'backend',
    features: ['axum', 'tokio', 'tower', 'serde'],
  },
};

// ─── Interactive Feature Options ──────────────────────────────────────────

interface ScaffoldOptions {
  projectName: string;
  template: string;
  typescript: boolean;
  testing: boolean;
  docker: boolean;
  cicd: boolean;
  description?: string;
}

// ─── Template File Generators ─────────────────────────────────────────────

function generatePackageJson(opts: ScaffoldOptions): string {
  const tpl = TEMPLATES[opts.template];
  if (!tpl || !['typescript', 'javascript'].includes(tpl.language)) return '';

  const pkg: Record<string, any> = {
    name: opts.projectName,
    version: '0.1.0',
    private: true,
    description: opts.description || `${tpl.label} project created with Orion CLI`,
    scripts: {} as Record<string, string>,
    dependencies: {} as Record<string, string>,
    devDependencies: {} as Record<string, string>,
  };

  switch (opts.template) {
    case 'react':
      pkg.scripts = {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
        lint: 'eslint src/',
      };
      pkg.dependencies = { react: '^18.3.0', 'react-dom': '^18.3.0', 'react-router-dom': '^6.23.0' };
      pkg.devDependencies = { vite: '^5.4.0', '@vitejs/plugin-react': '^4.3.0', eslint: '^9.0.0' };
      if (opts.typescript) {
        pkg.devDependencies['typescript'] = '^5.5.0';
        pkg.devDependencies['@types/react'] = '^18.3.0';
        pkg.devDependencies['@types/react-dom'] = '^18.3.0';
      }
      break;

    case 'next':
      pkg.scripts = { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' };
      pkg.dependencies = { next: '^14.2.0', react: '^18.3.0', 'react-dom': '^18.3.0' };
      pkg.devDependencies = { eslint: '^9.0.0', 'eslint-config-next': '^14.2.0' };
      if (opts.typescript) {
        pkg.devDependencies['typescript'] = '^5.5.0';
        pkg.devDependencies['@types/node'] = '^20.0.0';
        pkg.devDependencies['@types/react'] = '^18.3.0';
      }
      break;

    case 'vue':
      pkg.scripts = { dev: 'vite', build: 'vite build', preview: 'vite preview' };
      pkg.dependencies = { vue: '^3.4.0', 'vue-router': '^4.3.0', pinia: '^2.1.0' };
      pkg.devDependencies = { vite: '^5.4.0', '@vitejs/plugin-vue': '^5.0.0' };
      if (opts.typescript) {
        pkg.devDependencies['typescript'] = '^5.5.0';
        pkg.devDependencies['vue-tsc'] = '^2.0.0';
      }
      break;

    case 'svelte':
      pkg.scripts = { dev: 'vite dev', build: 'vite build', preview: 'vite preview' };
      pkg.devDependencies = { '@sveltejs/kit': '^2.5.0', svelte: '^4.2.0', vite: '^5.4.0' };
      if (opts.typescript) {
        pkg.devDependencies['typescript'] = '^5.5.0';
        pkg.devDependencies['svelte-check'] = '^3.8.0';
      }
      break;

    case 'express':
      pkg.scripts = { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js', lint: 'eslint src/' };
      pkg.dependencies = { express: '^4.19.0', cors: '^2.8.5', helmet: '^7.1.0', 'express-validator': '^7.0.0' };
      pkg.devDependencies = { tsx: '^4.15.0', eslint: '^9.0.0' };
      if (opts.typescript) {
        pkg.devDependencies['typescript'] = '^5.5.0';
        pkg.devDependencies['@types/express'] = '^4.17.0';
        pkg.devDependencies['@types/cors'] = '^2.8.0';
        pkg.devDependencies['@types/node'] = '^20.0.0';
      }
      break;

    case 'fastify':
      pkg.scripts = { dev: 'tsx watch src/index.ts', build: 'tsc', start: 'node dist/index.js' };
      pkg.dependencies = { fastify: '^4.28.0', '@fastify/cors': '^9.0.0', '@fastify/swagger': '^8.14.0' };
      pkg.devDependencies = { tsx: '^4.15.0' };
      if (opts.typescript) {
        pkg.devDependencies['typescript'] = '^5.5.0';
        pkg.devDependencies['@types/node'] = '^20.0.0';
      }
      break;

    case 'nestjs':
      pkg.scripts = { dev: 'nest start --watch', build: 'nest build', start: 'node dist/main.js', lint: 'eslint src/' };
      pkg.dependencies = { '@nestjs/core': '^10.3.0', '@nestjs/common': '^10.3.0', '@nestjs/platform-express': '^10.3.0', 'reflect-metadata': '^0.2.0', rxjs: '^7.8.0' };
      pkg.devDependencies = { '@nestjs/cli': '^10.3.0', '@nestjs/schematics': '^10.1.0', typescript: '^5.5.0', '@types/node': '^20.0.0' };
      break;
  }

  if (opts.testing && tpl.language !== 'python' && tpl.language !== 'go' && tpl.language !== 'rust') {
    pkg.scripts['test'] = 'vitest';
    pkg.devDependencies['vitest'] = '^1.6.0';
    pkg.devDependencies['@testing-library/jest-dom'] = '^6.4.0';
  }

  return JSON.stringify(pkg, null, 2);
}

function generateTsConfig(opts: ScaffoldOptions): string {
  const tpl = TEMPLATES[opts.template];
  if (!opts.typescript || !tpl || !['typescript', 'javascript'].includes(tpl.language)) return '';

  const base: Record<string, any> = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
    },
    include: ['src'],
    exclude: ['node_modules', 'dist'],
  };

  if (['react', 'next'].includes(opts.template)) {
    base.compilerOptions.jsx = 'react-jsx';
    base.compilerOptions.lib = ['DOM', 'DOM.Iterable', 'ES2022'];
  }

  if (['express', 'fastify', 'nestjs'].includes(opts.template)) {
    base.compilerOptions.outDir = './dist';
    base.compilerOptions.declaration = true;
    base.compilerOptions.sourceMap = true;
  }

  if (opts.template === 'nestjs') {
    base.compilerOptions.emitDecoratorMetadata = true;
    base.compilerOptions.experimentalDecorators = true;
  }

  return JSON.stringify(base, null, 2);
}

function generateEntryFile(opts: ScaffoldOptions): { filename: string; content: string } {
  const ext = opts.typescript ? 'ts' : 'js';
  const tsx = opts.typescript ? 'tsx' : 'jsx';

  switch (opts.template) {
    case 'react':
      return {
        filename: `src/App.${tsx}`,
        content: `${opts.typescript ? "import React from 'react';\n" : ''}
export default function App() {
  return (
    <div className="app">
      <header>
        <h1>${opts.projectName}</h1>
        <p>Welcome to your new React app, scaffolded by Orion CLI.</p>
      </header>
      <main>
        <p>Edit <code>src/App.${tsx}</code> and save to reload.</p>
      </main>
    </div>
  );
}
`,
      };

    case 'next':
      return {
        filename: `app/page.${tsx}`,
        content: `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-4xl font-bold">${opts.projectName}</h1>
      <p className="mt-4 text-lg text-gray-600">
        Built with Next.js, scaffolded by Orion CLI.
      </p>
    </main>
  );
}
`,
      };

    case 'vue':
      return {
        filename: `src/App.vue`,
        content: `<script setup${opts.typescript ? ' lang="ts"' : ''}>
import { ref } from 'vue';

const count = ref(0);
</script>

<template>
  <div class="app">
    <h1>${opts.projectName}</h1>
    <p>Welcome to your new Vue app, scaffolded by Orion CLI.</p>
    <button @click="count++">Count: {{ count }}</button>
  </div>
</template>

<style scoped>
.app {
  text-align: center;
  padding: 2rem;
}
</style>
`,
      };

    case 'svelte':
      return {
        filename: `src/routes/+page.svelte`,
        content: `<script${opts.typescript ? ' lang="ts"' : ''}>
  let count = 0;
</script>

<main>
  <h1>${opts.projectName}</h1>
  <p>Welcome to your SvelteKit app, scaffolded by Orion CLI.</p>
  <button on:click={() => count++}>Count: {count}</button>
</main>

<style>
  main {
    text-align: center;
    padding: 2rem;
  }
</style>
`,
      };

    case 'express':
      return {
        filename: `src/index.${ext}`,
        content: `import express${opts.typescript ? ', { Request, Response, NextFunction }' : ''} from 'express';
import cors from 'cors';
import helmet from 'helmet';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req${opts.typescript ? ': Request' : ''}, res${opts.typescript ? ': Response' : ''}) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// API routes
app.get('/api', (_req${opts.typescript ? ': Request' : ''}, res${opts.typescript ? ': Response' : ''}) => {
  res.json({ message: 'Welcome to ${opts.projectName} API' });
});

// Error handler
app.use((err${opts.typescript ? ': Error' : ''}, _req${opts.typescript ? ': Request' : ''}, res${opts.typescript ? ': Response' : ''}, _next${opts.typescript ? ': NextFunction' : ''}) => {
  console.error(err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});

export default app;
`,
      };

    case 'fastify':
      return {
        filename: `src/index.${ext}`,
        content: `import Fastify from 'fastify';
import cors from '@fastify/cors';

const app = Fastify({ logger: true });

// Plugins
app.register(cors);

// Health check
app.get('/health', async () => {
  return { status: 'ok', uptime: process.uptime() };
});

// API routes
app.get('/api', async () => {
  return { message: 'Welcome to ${opts.projectName} API' };
});

// Start server
const start = async () => {
  try {
    await app.listen({ port: ${opts.typescript ? 'Number(process.env.PORT) || ' : ''}3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

export default app;
`,
      };

    case 'nestjs':
      return {
        filename: `src/main.ts`,
        content: `import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(\`${opts.projectName} running on http://localhost:\${port}\`);
}

bootstrap();
`,
      };

    case 'python-flask':
      return {
        filename: 'app/__init__.py',
        content: `"""${opts.projectName} - Flask Application Factory."""

from flask import Flask
from flask_cors import CORS


def create_app(config_name: str = "development") -> Flask:
    """Create and configure the Flask application."""
    app = Flask(__name__)
    CORS(app)

    # Configuration
    app.config["SECRET_KEY"] = "change-this-in-production"

    # Register blueprints
    from app.routes import api_bp
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.route("/health")
    def health():
        return {"status": "ok"}

    return app
`,
      };

    case 'python-fastapi':
      return {
        filename: 'app/main.py',
        content: `"""${opts.projectName} - FastAPI Application."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="${opts.projectName}",
    description="${opts.description || 'API scaffolded by Orion CLI'}",
    version="0.1.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api")
async def root():
    """Root API endpoint."""
    return {"message": f"Welcome to ${opts.projectName} API"}
`,
      };

    case 'go-gin':
      return {
        filename: 'main.go',
        content: `package main

import (
\t"log"
\t"net/http"
\t"os"

\t"github.com/gin-gonic/gin"
)

func main() {
\trouter := gin.Default()

\t// Health check
\trouter.GET("/health", func(c *gin.Context) {
\t\tc.JSON(http.StatusOK, gin.H{"status": "ok"})
\t})

\t// API routes
\tapi := router.Group("/api")
\t{
\t\tapi.GET("/", func(c *gin.Context) {
\t\t\tc.JSON(http.StatusOK, gin.H{"message": "Welcome to ${opts.projectName} API"})
\t\t})
\t}

\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "8080"
\t}

\tlog.Printf("${opts.projectName} running on http://localhost:%s", port)
\tif err := router.Run(":" + port); err != nil {
\t\tlog.Fatal(err)
\t}
}
`,
      };

    case 'rust-axum':
      return {
        filename: 'src/main.rs',
        content: `use axum::{routing::get, Json, Router};
use serde_json::{json, Value};
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    tracing_subscriber::init();

    let app = Router::new()
        .route("/health", get(health))
        .route("/api", get(root));

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse()
        .expect("PORT must be a number");

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("${opts.projectName} running on http://{addr}");

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn root() -> Json<Value> {
    Json(json!({ "message": "Welcome to ${opts.projectName} API" }))
}
`,
      };

    default:
      return { filename: `src/index.${ext}`, content: `// ${opts.projectName}\nconsole.log("Hello from ${opts.projectName}");\n` };
  }
}

function generateReadme(opts: ScaffoldOptions): string {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) return '';

  return `# ${opts.projectName}

${opts.description || `A ${tpl.label} project scaffolded by Orion CLI.`}

## Tech Stack

- **Framework:** ${tpl.label}
- **Language:** ${tpl.language}${opts.typescript && tpl.language !== 'typescript' ? ' (TypeScript)' : ''}
${opts.testing ? '- **Testing:** Vitest' : ''}
${opts.docker ? '- **Container:** Docker' : ''}
${opts.cicd ? '- **CI/CD:** GitHub Actions' : ''}

## Getting Started

\`\`\`bash
cd ${opts.projectName}
${tpl.language === 'python' ? 'pip install -r requirements.txt\npython -m app' : tpl.language === 'go' ? 'go mod tidy\ngo run .' : tpl.language === 'rust' ? 'cargo build\ncargo run' : 'npm install\nnpm run dev'}
\`\`\`

## Project Structure

\`\`\`
${opts.projectName}/
${tpl.language === 'python' ? '├── app/\n│   ├── __init__.py\n│   ├── main.py\n│   └── routes/\n├── tests/\n├── requirements.txt' : tpl.language === 'go' ? '├── main.go\n├── handlers/\n├── models/\n├── go.mod' : tpl.language === 'rust' ? '├── src/\n│   └── main.rs\n├── Cargo.toml' : '├── src/\n│   └── index.' + (opts.typescript ? 'ts' : 'js') + '\n├── package.json\n├── tsconfig.json'}
├── .orion/
│   └── context.md
└── README.md
\`\`\`

---

*Scaffolded with [Orion CLI](https://github.com/orion-ide/orion)*
`;
}

function generateDockerfile(opts: ScaffoldOptions): string {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) return '';

  if (tpl.language === 'python') {
    return `FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
`;
  }

  if (tpl.language === 'go') {
    return `FROM golang:1.22-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o server .

FROM alpine:3.19
WORKDIR /app
COPY --from=builder /app/server .

EXPOSE 8080

CMD ["./server"]
`;
  }

  if (tpl.language === 'rust') {
    return `FROM rust:1.78-slim AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/target/release/${opts.projectName} .

EXPOSE 3000

CMD ["./${opts.projectName}"]
`;
  }

  // Node.js-based projects
  if (tpl.category === 'frontend' || tpl.category === 'fullstack') {
    return `FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

EXPOSE 3000

CMD ["npm", "start"]
`;
  }

  return `FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --production

COPY dist ./dist

EXPOSE 3000

CMD ["node", "dist/index.js"]
`;
}

function generateGithubActions(opts: ScaffoldOptions): string {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) return '';

  if (tpl.language === 'python') {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ['3.11', '3.12']

    steps:
      - uses: actions/checkout@v4
      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: \${{ matrix.python-version }}
      - name: Install dependencies
        run: pip install -r requirements.txt
      - name: Lint
        run: python -m flake8 app/
      - name: Test
        run: python -m pytest tests/ -v
`;
  }

  if (tpl.language === 'go') {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - name: Build
        run: go build -v ./...
      - name: Test
        run: go test -v ./...
`;
  }

  if (tpl.language === 'rust') {
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - name: Build
        run: cargo build --verbose
      - name: Test
        run: cargo test --verbose
      - name: Clippy
        run: cargo clippy -- -D warnings
`;
  }

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
          cache: 'npm'
      - run: npm ci
      - run: npm run lint --if-present
      - run: npm test --if-present
      - run: npm run build
`;
}

function generateOrionContext(opts: ScaffoldOptions): string {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) return '';

  return `# ${opts.projectName}

## Overview
${opts.description || `A ${tpl.label} project.`}

## Tech Stack
- Framework: ${tpl.label}
- Language: ${tpl.language}${opts.typescript ? ' (TypeScript)' : ''}
${opts.testing ? '- Testing: Vitest / pytest' : ''}
${opts.docker ? '- Containerized with Docker' : ''}

## Conventions
- Follow ${tpl.label} best practices and idiomatic patterns.
- Use meaningful variable and function names.
- Write tests for new features.
- Keep functions small and focused.

## Project Notes
- Created with Orion CLI scaffold command.
- Edit this file to add project-specific context for Orion AI commands.
`;
}

function generateGitignore(opts: ScaffoldOptions): string {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) return '';

  const common = `# Dependencies
node_modules/
__pycache__/
*.pyc
target/
vendor/

# Build output
dist/
build/
.next/
.svelte-kit/
*.egg-info/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Coverage
coverage/
.coverage
htmlcov/
`;

  return common;
}

function generateLanguageConfig(opts: ScaffoldOptions): { filename: string; content: string } | null {
  const tpl = TEMPLATES[opts.template];
  if (!tpl) return null;

  if (tpl.language === 'python') {
    return {
      filename: 'requirements.txt',
      content: opts.template === 'python-fastapi'
        ? 'fastapi>=0.111.0\nuvicorn[standard]>=0.30.0\npydantic>=2.7.0\npython-dotenv>=1.0.0\n'
        : 'flask>=3.0.0\nflask-cors>=4.0.0\nflask-sqlalchemy>=3.1.0\nmarshmallow>=3.21.0\npython-dotenv>=1.0.0\n',
    };
  }

  if (tpl.language === 'go') {
    return {
      filename: 'go.mod',
      content: `module ${opts.projectName}\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.10.0\n`,
    };
  }

  if (tpl.language === 'rust') {
    return {
      filename: 'Cargo.toml',
      content: `[package]
name = "${opts.projectName}"
version = "0.1.0"
edition = "2021"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
tower = "0.4"
tower-http = { version = "0.5", features = ["cors"] }
`,
    };
  }

  return null;
}

// ─── Scaffold Files to Disk ───────────────────────────────────────────────

function writeScaffoldFiles(opts: ScaffoldOptions): string[] {
  const projectDir = path.resolve(process.cwd(), opts.projectName);
  const createdFiles: string[] = [];

  // Create project directory
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  // package.json or language-specific config
  const pkgJson = generatePackageJson(opts);
  if (pkgJson) {
    writeFileContent(path.join(projectDir, 'package.json'), pkgJson);
    createdFiles.push('package.json');
  }

  const langConfig = generateLanguageConfig(opts);
  if (langConfig) {
    writeFileContent(path.join(projectDir, langConfig.filename), langConfig.content);
    createdFiles.push(langConfig.filename);
  }

  // tsconfig.json
  const tsConfig = generateTsConfig(opts);
  if (tsConfig) {
    writeFileContent(path.join(projectDir, 'tsconfig.json'), tsConfig);
    createdFiles.push('tsconfig.json');
  }

  // Entry file
  const entry = generateEntryFile(opts);
  writeFileContent(path.join(projectDir, entry.filename), entry.content);
  createdFiles.push(entry.filename);

  // README
  const readme = generateReadme(opts);
  if (readme) {
    writeFileContent(path.join(projectDir, 'README.md'), readme);
    createdFiles.push('README.md');
  }

  // .gitignore
  const gitignore = generateGitignore(opts);
  if (gitignore) {
    writeFileContent(path.join(projectDir, '.gitignore'), gitignore);
    createdFiles.push('.gitignore');
  }

  // .orion/context.md
  const orionCtx = generateOrionContext(opts);
  if (orionCtx) {
    writeFileContent(path.join(projectDir, '.orion', 'context.md'), orionCtx);
    createdFiles.push('.orion/context.md');
  }

  // Dockerfile
  if (opts.docker) {
    const dockerfile = generateDockerfile(opts);
    if (dockerfile) {
      writeFileContent(path.join(projectDir, 'Dockerfile'), dockerfile);
      createdFiles.push('Dockerfile');
    }
  }

  // CI/CD
  if (opts.cicd) {
    const ciFile = generateGithubActions(opts);
    if (ciFile) {
      writeFileContent(path.join(projectDir, '.github', 'workflows', 'ci.yml'), ciFile);
      createdFiles.push('.github/workflows/ci.yml');
    }
  }

  return createdFiles;
}

// ─── AI Customization ─────────────────────────────────────────────────────

async function aiCustomizeScaffold(opts: ScaffoldOptions): Promise<string | null> {
  if (!opts.description) return null;

  const tpl = TEMPLATES[opts.template];
  if (!tpl) return null;

  const spinner = startSpinner('AI is customizing your scaffold...');

  try {
    const systemPrompt = `You are Orion, an expert project scaffolder. The user is creating a new ${tpl.label} project named "${opts.projectName}". Based on their project description, suggest 3-5 specific customizations that would make the scaffold more useful for their use case. Be concise and actionable.

Format each suggestion as:
- [filename] Description of what to add or change

Keep suggestions practical and specific to the project description.`;

    const userMessage = `Project: ${opts.projectName}
Template: ${tpl.label} (${tpl.language})
Description: ${opts.description}
Features: TypeScript=${opts.typescript}, Testing=${opts.testing}, Docker=${opts.docker}, CI/CD=${opts.cicd}

What specific customizations would improve this scaffold for the described use case?`;

    const { callbacks, getResponse } = createSilentStreamHandler(spinner, 'AI suggestions ready');
    await askAI(systemPrompt, userMessage, callbacks);

    return getResponse().trim();
  } catch {
    stopSpinner(spinner, 'AI customization skipped', false);
    return null;
  }
}

// ─── Template Category Badge ──────────────────────────────────────────────

function categoryBadge(category: string): string {
  const colorMap: Record<string, string> = {
    frontend: '#61DAFB',
    backend: '#22C55E',
    fullstack: '#F59E0B',
  };
  return badge(category, colorMap[category] || '#7C5CFC');
}

// ─── Main Command ─────────────────────────────────────────────────────────

export async function scaffoldCommand(
  template?: string,
  projectName?: string,
  options?: { list?: boolean; description?: string }
): Promise<void> {
  const pipelineOpts = getPipelineOptions();

  // --list mode: show all templates
  if (options?.list) {
    console.log(commandHeader('Orion Scaffold: Available Templates'));
    console.log();
    console.log(uiTable(
      ['Template', 'Category', 'Language', 'Description'],
      Object.entries(TEMPLATES).map(([key, tpl]) => [
        palette.violet(key),
        categoryBadge(tpl.category),
        tpl.language,
        tpl.description,
      ]),
    ));
    console.log();
    printInfo(`Usage: ${colors.command('orion scaffold <template> <project-name>')}`);
    console.log();
    return;
  }

  // Interactive mode if no template specified
  let opts: ScaffoldOptions;

  if (!template) {
    console.log(commandHeader('Orion Scaffold: Project Creation Wizard'));
    console.log();

    const templateChoices = Object.entries(TEMPLATES).map(([key, tpl]) => ({
      name: `${tpl.label.padEnd(18)} ${palette.dim(tpl.description)}`,
      value: key,
    }));

    const { template: chosenTemplate } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Select a project template:',
      choices: templateChoices,
      pageSize: 12,
    }]);

    const { projectName: chosenName } = await inquirer.prompt([{
      type: 'input',
      name: 'projectName',
      message: 'Project name:',
      validate: (input: string) => {
        if (!input.trim()) return 'Project name is required.';
        if (/[^a-zA-Z0-9._-]/.test(input)) return 'Use only letters, numbers, dots, hyphens, and underscores.';
        if (fs.existsSync(path.resolve(process.cwd(), input))) return `Directory "${input}" already exists.`;
        return true;
      },
    }]);

    const { description: chosenDesc } = await inquirer.prompt([{
      type: 'input',
      name: 'description',
      message: 'Project description (optional, used by AI for customization):',
    }]);

    const chosenTpl = TEMPLATES[chosenTemplate];
    let useTypescript = true;
    if (chosenTpl && ['typescript', 'javascript'].includes(chosenTpl.language)) {
      const { typescript: tsAnswer } = await inquirer.prompt([{
        type: 'confirm',
        name: 'typescript',
        message: 'Use TypeScript?',
        default: true,
      }]);
      useTypescript = tsAnswer;
    }

    const { testing: chosenTesting } = await inquirer.prompt([{
      type: 'confirm',
      name: 'testing',
      message: 'Include testing setup?',
      default: true,
    }]);

    const { docker: chosenDocker } = await inquirer.prompt([{
      type: 'confirm',
      name: 'docker',
      message: 'Include Dockerfile?',
      default: false,
    }]);

    const { cicd: chosenCicd } = await inquirer.prompt([{
      type: 'confirm',
      name: 'cicd',
      message: 'Include GitHub Actions CI/CD?',
      default: false,
    }]);

    opts = {
      projectName: chosenName,
      template: chosenTemplate,
      typescript: useTypescript,
      testing: chosenTesting ?? true,
      docker: chosenDocker ?? false,
      cicd: chosenCicd ?? false,
      description: chosenDesc || undefined,
    };
  } else {
    // Non-interactive mode: template and project name from args
    const tmplKey = template.toLowerCase();

    if (!TEMPLATES[tmplKey]) {
      console.log(commandHeader('Orion Scaffold'));
      console.log();
      printError(`Unknown template: "${template}"`);
      console.log();
      printInfo('Available templates:');
      for (const [key, tpl] of Object.entries(TEMPLATES)) {
        console.log(`    ${colors.command(key.padEnd(18))} ${palette.dim(tpl.description)}`);
      }
      console.log();
      printInfo(`Run ${colors.command('orion scaffold --list')} for the full list.`);
      console.log();
      process.exit(1);
    }

    if (!projectName || !projectName.trim()) {
      console.log(commandHeader('Orion Scaffold'));
      console.log();
      printError('Project name is required.');
      console.log();
      printInfo(`Usage: ${colors.command(`orion scaffold ${tmplKey} <project-name>`)}`);
      console.log();
      process.exit(1);
    }

    const projectDir = path.resolve(process.cwd(), projectName);
    if (fs.existsSync(projectDir) && !pipelineOpts.yes) {
      printError(`Directory "${projectName}" already exists.`);
      console.log();
      process.exit(1);
    }

    const tpl = TEMPLATES[tmplKey];
    opts = {
      projectName,
      template: tmplKey,
      typescript: tpl.language === 'typescript' || tpl.language === 'javascript',
      testing: true,
      docker: false,
      cicd: false,
      description: options?.description,
    };
  }

  // Show scaffold plan
  const tpl = TEMPLATES[opts.template];
  console.log(commandHeader('Orion Scaffold', [
    ['Template', `${tpl.label} ${categoryBadge(tpl.category)}`],
    ['Project', colors.file(opts.projectName)],
    ['Language', tpl.language + (opts.typescript ? ' (TypeScript)' : '')],
    ['Features', [
      opts.testing ? 'testing' : null,
      opts.docker ? 'docker' : null,
      opts.cicd ? 'ci/cd' : null,
    ].filter(Boolean).join(', ') || 'none'],
  ]));

  // AI customization if description provided
  let aiSuggestions: string | null = null;
  if (opts.description) {
    aiSuggestions = await aiCustomizeScaffold(opts);
    if (aiSuggestions && !pipelineOpts.quiet) {
      console.log();
      console.log(divider('AI Suggestions'));
      console.log();
      const lines = aiSuggestions.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(`  ${palette.dim(line)}`);
        }
      }
      console.log();
    }
  }

  if (pipelineOpts.dryRun) {
    printInfo('Dry run: no files were created.');
    jsonOutput('scaffold', {
      template: opts.template,
      projectName: opts.projectName,
      dryRun: true,
    });
    console.log();
    return;
  }

  // Create files
  const createSpinner = startSpinner('Creating project files...');
  const createdFiles = writeScaffoldFiles(opts);
  stopSpinner(createSpinner, `Created ${createdFiles.length} files`);

  // Summary
  console.log();
  console.log(divider('Created Files'));
  console.log();
  for (const file of createdFiles) {
    console.log(`  ${palette.green('+')} ${colors.file(file)}`);
  }
  console.log();

  printSuccess(`Project "${opts.projectName}" scaffolded successfully!`);
  console.log();

  // Next steps
  console.log(`  ${palette.dim('Next steps:')}`);
  console.log(`    ${palette.dim('1.')} ${colors.command(`cd ${opts.projectName}`)}`);

  if (['typescript', 'javascript'].includes(tpl.language)) {
    console.log(`    ${palette.dim('2.')} ${colors.command('npm install')}`);
    console.log(`    ${palette.dim('3.')} ${colors.command('npm run dev')}`);
  } else if (tpl.language === 'python') {
    console.log(`    ${palette.dim('2.')} ${colors.command('pip install -r requirements.txt')}`);
    console.log(`    ${palette.dim('3.')} ${colors.command('python -m uvicorn app.main:app --reload')}`);
  } else if (tpl.language === 'go') {
    console.log(`    ${palette.dim('2.')} ${colors.command('go mod tidy')}`);
    console.log(`    ${palette.dim('3.')} ${colors.command('go run .')}`);
  } else if (tpl.language === 'rust') {
    console.log(`    ${palette.dim('2.')} ${colors.command('cargo build')}`);
    console.log(`    ${palette.dim('3.')} ${colors.command('cargo run')}`);
  }

  console.log();
  console.log(`    ${palette.dim('Orion AI:')} ${colors.command(`orion review ${opts.projectName}/`)} to review the code`);
  console.log(`    ${palette.dim('Orion AI:')} ${colors.command(`orion edit ${opts.projectName}/`)} to customize with AI`);
  console.log();

  jsonOutput('scaffold', {
    template: opts.template,
    projectName: opts.projectName,
    language: tpl.language,
    files: createdFiles,
    aiSuggestions: aiSuggestions ? true : false,
  });
}
