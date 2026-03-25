#!/bin/bash

# 1. Type Check
echo "Running TypeScript check..."
npx tsc --noEmit
if [ $? -ne 0 ]; then echo "❌ Type check failed"; exit 1; fi

# 2. Linting
echo "Running ESLint..."
npm run lint
if [ $? -ne 0 ]; then echo "❌ Linting failed"; exit 1; fi

# 3. Build Test
echo "Running Production Build Test..."
npm run build
if [ $? -ne 0 ]; then echo "❌ Build failed"; exit 1; fi

echo "✅ All checks passed!"