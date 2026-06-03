import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@xyflow/react')) return 'flow';
          if (id.includes('tesseract.js')) return 'ocr';
          if (id.includes('pptxgenjs') || id.includes('jszip')) return 'document-tools';
          if (id.includes('react-dom') || id.includes('react')) return 'react-vendor';
          return undefined;
        },
      },
    },
  },
});
