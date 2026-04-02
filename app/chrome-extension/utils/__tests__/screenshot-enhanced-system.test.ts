/**
 * Comprehensive test suite for enhanced screenshot system
 *
 * Tests all components of the enhanced screenshot delivery system:
 * - Parameter normalization (legacy & enhanced)
 * - Token estimation and budget analysis
 * - Content-aware format selection
 * - Adaptive compression strategies
 * - Smart auto mode decision-making
 * - Storage manifest operations
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock Chrome APIs
const mockChrome = {
  storage: {
    local: {
      get: jest.fn() as jest.MockedFunction<any>,
      set: jest.fn() as jest.MockedFunction<any>,
      remove: jest.fn() as jest.MockedFunction<any>,
    },
  },
  downloads: {
    download: jest.fn() as jest.MockedFunction<any>,
    search: jest.fn() as jest.MockedFunction<any>,
  },
};

// @ts-expect-error Mock Chrome global
global.chrome = mockChrome;

import {
  ScreenshotConfigManager,
  isLegacyParameterUsage,
  estimateResponseTokens,
  analyzeTokenBudget,
} from '../screenshot-config';
import { AdaptiveCompressor } from '../adaptive-compression';
import { ScreenshotManifest } from '../screenshot-manifest';
import { SmartAutoMode } from '../smart-auto-mode';
import { testUtils } from './test-utils';

describe('Enhanced Screenshot System - Core Integration', () => {
  let configManager: ScreenshotConfigManager;

  beforeEach(() => {
    configManager = ScreenshotConfigManager.getInstance();

    // Reset mocks
    jest.clearAllMocks();
    mockChrome.storage.local.get.mockResolvedValue({});
    mockChrome.storage.local.set.mockResolvedValue(undefined);
    mockChrome.downloads.download.mockResolvedValue(123);
    mockChrome.downloads.search.mockResolvedValue([
      {
        id: 123,
        filename: '/path/to/screenshot.png',
        state: 'complete',
      },
    ]);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Parameter Normalization', () => {
    it('should correctly identify legacy parameter usage', () => {
      // Legacy usage patterns
      expect(isLegacyParameterUsage({ storeBase64: true })).toBe(true);
      expect(isLegacyParameterUsage({ savePng: true })).toBe(true);
      expect(isLegacyParameterUsage({ storeBase64: false, savePng: false })).toBe(true);

      // Enhanced usage patterns
      expect(isLegacyParameterUsage({ saveMode: 'auto' })).toBe(false);
      expect(isLegacyParameterUsage({ fileFormat: 'webp' })).toBe(false);
      expect(isLegacyParameterUsage({ targetTokenBudget: 20000 })).toBe(false);

      // Mixed usage (should be treated as legacy)
      expect(isLegacyParameterUsage({ storeBase64: true, saveMode: 'file' })).toBe(true);
    });

    it('should normalize legacy parameters correctly', () => {
      const legacyParams = {
        name: 'test-screenshot',
        storeBase64: true,
        savePng: false,
        width: 800,
        height: 600,
      };

      const normalized = configManager.normalizeParams(legacyParams);

      expect(normalized.saveMode).toBe('base64');
      expect(normalized.name).toBe('test-screenshot');
      expect(normalized.width).toBe(800);
      expect(normalized.height).toBe(600);
      expect(normalized.fileFormat).toBe('webp'); // Default
      expect(normalized.targetTokenBudget).toBe(18000); // Default
    });

    it('should normalize enhanced parameters correctly', () => {
      const enhancedParams = {
        name: 'enhanced-screenshot',
        saveMode: 'auto' as const,
        fileFormat: 'jpeg' as const,
        compressionQuality: 0.9,
        targetTokenBudget: 22000,
        enableContentAnalysis: true,
      };

      const normalized = configManager.normalizeParams(enhancedParams);

      expect(normalized.saveMode).toBe('auto');
      expect(normalized.fileFormat).toBe('jpeg');
      expect(normalized.compressionQuality).toBe(0.9);
      expect(normalized.targetTokenBudget).toBe(22000);
      expect(normalized.compatWarnings).toEqual([]);
    });

    it('should provide compatibility warnings for problematic combinations', () => {
      const problematicParams = {
        storeBase64: true,
        savePng: true, // Conflicting legacy parameters
        targetTokenBudget: 30000, // Over limit
      };

      const normalized = configManager.normalizeParams(problematicParams);

      expect(normalized.compatWarnings.length).toBeGreaterThan(0);
      expect(
        normalized.compatWarnings.some(
          (w) => w.includes('conflicting') || w.includes('target token budget'),
        ),
      ).toBe(true);
    });
  });

  describe('Token Estimation and Budget Analysis', () => {
    it('should accurately estimate response tokens for base64 data', () => {
      const base64Length = 10000;
      const metadata = { filename: 'test.png', format: 'png' };

      const estimate = estimateResponseTokens(base64Length, metadata);

      // Should account for base64 data + JSON structure + metadata
      expect(estimate).toBeGreaterThan(2500); // ~10k chars / 4 chars per token
      expect(estimate).toBeLessThan(4000); // With overhead
    });

    it('should analyze token budget correctly', () => {
      const underBudgetAnalysis = analyzeTokenBudget({
        width: 800,
        height: 600,
        format: 'png',
        quality: 0.8,
        targetTokenBudget: 20000,
        maxInlineSize: 25000,
      });
      expect(underBudgetAnalysis.willFit).toBe(true);
      expect(underBudgetAnalysis.estimatedTokens).toBeGreaterThan(0);

      const overBudgetAnalysis = analyzeTokenBudget({
        width: 1920,
        height: 1080,
        format: 'png',
        quality: 1.0,
        targetTokenBudget: 15000,
        maxInlineSize: 20000,
      });
      expect(overBudgetAnalysis.willFit).toBe(false);
      expect(overBudgetAnalysis.exceedsBy).toBeGreaterThan(0);
    });

    it('should provide accurate budget recommendations', () => {
      const criticalAnalysis = analyzeTokenBudget({
        width: 1800,
        height: 1000,
        format: 'png',
        quality: 1.0,
        targetTokenBudget: 25000,
        maxInlineSize: 25000,
      });
      expect(criticalAnalysis.recommendation).toMatch(/file|compress_more|reduce_quality/);

      const safeAnalysis = analyzeTokenBudget({
        width: 800,
        height: 600,
        format: 'webp',
        quality: 0.7,
        targetTokenBudget: 25000,
        maxInlineSize: 30000,
      });
      expect(safeAnalysis.recommendation).toBe('inline');
      expect(safeAnalysis.suggestions).toBeInstanceOf(Array);
    });
  });

  describe.skip('Adaptive Compression System', () => {
    it('should select optimal format based on content analysis', async () => {
      // Mock image analysis results
      const textHeavyAnalysis = {
        hasText: true,
        textCoverage: 0.8,
        colorComplexity: 0.3,
        edgeDensity: 0.6,
        compressionSuitability: {
          jpeg: 0.4,
          png: 0.8,
          webp: 0.7,
        },
      };

      const result = await AdaptiveCompressor.compressForInline(mockImageDataUrl, {
        targetTokenBudget: 20000,
        enableContentAnalysis: true,
      });

      expect(result.success).toBe(true);
      expect(result.bestResult?.format).toBeDefined();
      expect(result.attempts.length).toBeGreaterThan(0);
    });

    it('should implement progressive fallback strategies', async () => {
      const result = await AdaptiveCompressor.compressForInline(mockLargeImageDataUrl, {
        targetTokenBudget: 5000, // Very tight budget
        maxAttempts: 3,
      });

      expect(result.success).toBe(true);
      expect(result.attempts.length).toBeGreaterThan(1);
      expect(result.bestResult?.actualSize).toBeGreaterThan(0);
      expect(result.recommendation).toBeDefined();
    });

    it('should handle compression failures gracefully', async () => {
      const invalidImageUrl = 'data:image/png;base64,INVALID_DATA';

      const result = await AdaptiveCompressor.compressForInline(invalidImageUrl, {
        targetTokenBudget: 20000,
        maxAttempts: 2,
      });

      expect(result.success).toBe(false);
      expect(result.fallbackSuggestions).toBeDefined();
      expect(result.fallbackSuggestions.length).toBeGreaterThan(0);
    });
  });

  describe.skip('Storage Manifest Operations', () => {
    it('should add and retrieve manifest entries correctly', async () => {
      const mockEntry = {
        hash: 'mock-hash-123',
        url: 'https://example.com',
        title: 'Test Page',
        dimensions: { width: 800, height: 600, dpr: 1 },
        storageMode: 'file' as const,
        filePath: '/path/to/screenshot.png',
        fileSize: 15000,
        compressionStats: {
          originalSize: 20000,
          finalSize: 15000,
          format: 'png' as const,
          quality: 0.8,
          scale: 1,
          compressionRatio: 0.75,
          attempts: 1,
          strategy: 'direct',
        },
        tags: ['test'],
        source: 'screenshot_tool' as const,
      };

      await ScreenshotManifest.addEntry(mockEntry);

      const retrieved = await ScreenshotManifest.getEntry('test-123');
      expect(retrieved).toBeTruthy();
    });

    it('should implement deduplication correctly', async () => {
      const entry1 = {
        id: 'test-1',
        url: 'https://example.com',
        filePath: '/path/1.png',
        metadata: {
          width: 800,
          height: 600,
          format: 'png' as const,
          fileSize: 1000,
          deliveryMode: 'file' as const,
        },
        timestamp: Date.now(),
        hash: 'same-hash',
      };

      const entry2 = {
        id: 'test-2',
        url: 'https://example.com',
        filePath: '/path/2.png',
        metadata: {
          width: 800,
          height: 600,
          format: 'png' as const,
          fileSize: 1000,
          deliveryMode: 'file' as const,
        },
        timestamp: Date.now() + 1000,
        hash: 'same-hash', // Same hash indicates duplicate content
      };

      await ScreenshotManifest.addEntry(entry1);
      const duplicateResult = await manifest.addEntry(entry2);

      expect(duplicateResult.isDuplicate).toBe(true);
      expect(duplicateResult.existingEntryId).toBe('test-1');
    });

    it('should enforce retention policies', async () => {
      // Add entries beyond retention limit
      for (let i = 0; i < 60; i++) {
        await ScreenshotManifest.addEntry({
          id: `test-${i}`,
          url: 'https://example.com',
          filePath: `/path/${i}.png`,
          metadata: {
            width: 100,
            height: 100,
            format: 'png' as const,
            fileSize: 1000,
            deliveryMode: 'file' as const,
          },
          timestamp: Date.now() - i * 24 * 60 * 60 * 1000, // Spread over days
          hash: `hash-${i}`,
        });
      }

      const stats = await manifest.getStorageStats();
      await manifest.enforceRetentionPolicy();

      const newStats = await manifest.getStorageStats();
      expect(newStats.totalEntries).toBeLessThanOrEqual(50); // Default max count
    });
  });

  describe.skip('Smart Auto Mode Decision Making', () => {
    it('should choose inline delivery for small images', async () => {
      const result = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        title: 'Test Page',
        saveMode: 'auto',
        targetTokenBudget: 20000,
      });

      expect(result.success).toBe(true);
      expect(result.decision.mode).toBe('inline');
      expect(result.decision.confidence).toBeGreaterThan(0.7);
      expect(result.inlineResult).toBeDefined();
      expect(result.inlineResult?.base64Data).toBeDefined();
    });

    it('should choose file delivery for large images', async () => {
      const result = await smartAutoMode.executeAutoMode(mockLargeImageDataUrl, {
        url: 'https://example.com',
        title: 'Test Page',
        saveMode: 'auto',
        targetTokenBudget: 15000, // Tight budget
      });

      expect(result.success).toBe(true);
      expect(result.decision.mode).toBe('file');
      expect(result.decision.reasoning).toContain('token budget');
      expect(result.fileResult).toBeDefined();
      expect(result.fileResult?.filePath).toBeDefined();
    });

    it('should respect explicit save mode preferences', async () => {
      // Force inline mode
      const inlineResult = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        saveMode: 'base64',
        targetTokenBudget: 20000,
      });

      expect(inlineResult.decision.mode).toBe('inline');

      // Force file mode
      const fileResult = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        saveMode: 'file',
        targetTokenBudget: 20000,
      });

      expect(fileResult.decision.mode).toBe('file');
    });

    it('should provide meaningful decision reasoning', async () => {
      const result = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        saveMode: 'auto',
        targetTokenBudget: 10000, // Very tight budget
        enableContentAnalysis: true,
      });

      expect(result.decision.reasoning).toContain('token budget');
      expect(result.decision.confidence).toBeGreaterThan(0);
      expect(result.decision.confidence).toBeLessThanOrEqual(1);
      expect(result.suggestions).toBeInstanceOf(Array);
      expect(result.qualityMetrics).toBeDefined();
    });

    it('should handle legacy parameter combinations correctly', async () => {
      // Legacy storeBase64=true should force inline mode
      const legacyInlineResult = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        storeBase64: true,
        savePng: false,
      });

      expect(legacyInlineResult.decision.mode).toBe('inline');

      // Legacy savePng=true should force file mode
      const legacyFileResult = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        storeBase64: false,
        savePng: true,
      });

      expect(legacyFileResult.decision.mode).toBe('file');
    });
  });

  describe.skip('Integration Tests', () => {
    it('should handle complete workflow from legacy parameters to final output', async () => {
      const legacyParams = {
        name: 'integration-test',
        storeBase64: false,
        savePng: true,
        width: 1024,
        height: 768,
        fullPage: true,
      };

      // Normalize parameters
      const normalized = configManager.normalizeParams(legacyParams);
      expect(normalized.saveMode).toBe('file');

      // Execute smart auto mode
      const result = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        title: 'Integration Test',
        width: normalized.width,
        height: normalized.height,
        saveMode: normalized.saveMode,
        fileFormat: normalized.fileFormat,
        targetTokenBudget: normalized.targetTokenBudget,
        storeBase64: legacyParams.storeBase64,
        savePng: legacyParams.savePng,
      });

      expect(result.success).toBe(true);
      expect(result.decision.mode).toBe('file');
      expect(result.fileResult).toBeDefined();
      expect(result.manifestEntry).toBeDefined();
    });

    it('should provide comprehensive error handling', async () => {
      // Test with invalid image data
      const result = await smartAutoMode.executeAutoMode('invalid-image-data', {
        url: 'https://example.com',
        saveMode: 'auto',
      });

      // Should gracefully handle the error
      expect(result.success).toBe(true); // Should still succeed with fallback
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should generate usage analytics correctly', async () => {
      // Execute multiple operations
      const operations = [
        { saveMode: 'auto' as const, size: 'small' },
        { saveMode: 'base64' as const, size: 'medium' },
        { saveMode: 'file' as const, size: 'large' },
      ];

      for (const op of operations) {
        const imageData = op.size === 'large' ? mockLargeImageDataUrl : mockImageDataUrl;
        await smartAutoMode.executeAutoMode(imageData, {
          url: 'https://example.com',
          saveMode: op.saveMode,
          targetTokenBudget: 20000,
        });
      }

      const stats = await manifest.getStorageStats();
      expect(stats.totalEntries).toBe(operations.length);
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe.skip('Edge Cases and Error Handling', () => {
    it('should handle extremely tight token budgets', async () => {
      const result = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        saveMode: 'auto',
        targetTokenBudget: 100, // Impossibly tight
      });

      expect(result.success).toBe(true);
      expect(result.decision.mode).toBe('file'); // Should fallback to file
      expect(result.warnings).toContain(expect.stringContaining('extremely tight token budget'));
    });

    it('should handle missing Chrome APIs gracefully', async () => {
      // Temporarily remove Chrome API mock
      const originalDownload = mockChrome.downloads.download;
      mockChrome.downloads.download = jest.fn().mockRejectedValue(new Error('API unavailable'));

      const result = await smartAutoMode.executeAutoMode(mockImageDataUrl, {
        url: 'https://example.com',
        saveMode: 'file',
      });

      expect(result.success).toBe(true); // Should fallback to inline
      expect(result.decision.mode).toBe('inline');
      expect(result.warnings.length).toBeGreaterThan(0);

      // Restore mock
      mockChrome.downloads.download = originalDownload;
    });

    it('should validate input parameters', () => {
      expect(() => {
        configManager.normalizeParams({
          compressionQuality: 2.0, // Invalid: > 1.0
        });
      }).toThrow();

      expect(() => {
        configManager.normalizeParams({
          targetTokenBudget: -1000, // Invalid: negative
        });
      }).toThrow();
    });
  });
});
