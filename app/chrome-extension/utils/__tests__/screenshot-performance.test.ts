/**
 * Performance tests for enhanced screenshot system
 * Ensures the new system doesn't introduce significant overhead
 */

import { describe, it, expect, beforeEach } from '@jest/globals';

// Import our enhanced system components
import { ScreenshotConfigManager } from '../screenshot-config';
import { AdaptiveCompressor } from '../adaptive-compression';
import { ScreenshotManifest } from '../screenshot-manifest';
import { SmartAutoMode } from '../smart-auto-mode';
import { testUtils } from './test-utils';

describe.skip('Screenshot System Performance', () => {
  let configManager: ScreenshotConfigManager;
  let compressor: AdaptiveCompressor;
  let manifest: ScreenshotManifest;
  let smartAutoMode: SmartAutoMode;

  // Performance benchmarks (in milliseconds)
  const PERFORMANCE_THRESHOLDS = {
    parameterNormalization: 10, // Should be < 10ms
    tokenEstimation: 50, // Should be < 50ms
    compressionAnalysis: 500, // Should be < 500ms
    manifestOperations: 100, // Should be < 100ms
    smartModeDecision: 200, // Should be < 200ms
    endToEndProcessing: 2000, // Should be < 2s total
  };

  beforeEach(() => {
    configManager = ScreenshotConfigManager.getInstance();
    compressor = new AdaptiveCompressor();
    manifest = new ScreenshotManifest();
    smartAutoMode = new SmartAutoMode();
  });

  describe('Parameter Normalization Performance', () => {
    it('should normalize legacy parameters quickly', async () => {
      const legacyParams = {
        name: 'perf-test',
        storeBase64: true,
        savePng: false,
        width: 1920,
        height: 1080,
        fullPage: true,
      };

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        configManager.normalizeParams(legacyParams);
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / 1000;

      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.parameterNormalization);
      console.log(
        `✓ Parameter normalization: ${avgTime.toFixed(2)}ms avg (${PERFORMANCE_THRESHOLDS.parameterNormalization}ms threshold)`,
      );
    });

    it('should normalize enhanced parameters quickly', async () => {
      const enhancedParams = {
        name: 'enhanced-perf-test',
        saveMode: 'auto' as const,
        fileFormat: 'webp' as const,
        compressionQuality: 0.85,
        targetTokenBudget: 20000,
        enableContentAnalysis: true,
        tags: ['performance', 'test'],
        notes: 'Performance testing',
      };

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        configManager.normalizeParams(enhancedParams);
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / 1000;

      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.parameterNormalization);
      console.log(`✓ Enhanced parameter normalization: ${avgTime.toFixed(2)}ms avg`);
    });
  });

  describe('Token Estimation Performance', () => {
    it('should estimate tokens quickly for various sizes', async () => {
      const testSizes = [1000, 5000, 10000, 25000, 50000]; // Different base64 sizes

      const startTime = performance.now();

      for (const size of testSizes) {
        const mockBase64 = 'A'.repeat(size);
        const metadata = {
          filename: 'test.png',
          format: 'png',
          compressionRatio: 0.7,
          deliveryMode: 'inline',
        };

        // Run multiple iterations
        for (let i = 0; i < 100; i++) {
          const { estimateResponseTokens } = await import('../screenshot-config');
          estimateResponseTokens(mockBase64.length, metadata);
        }
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / (testSizes.length * 100);

      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.tokenEstimation);
      console.log(
        `✓ Token estimation: ${avgTime.toFixed(2)}ms avg (${PERFORMANCE_THRESHOLDS.tokenEstimation}ms threshold)`,
      );
    });
  });

  describe('Compression Performance', () => {
    it('should analyze compression suitability quickly', async () => {
      const mockImageDataUrl = testUtils.createMockImageDataUrl(10); // 10KB

      const startTime = performance.now();

      for (let i = 0; i < 50; i++) {
        await AdaptiveCompressor.compressForInline(mockImageDataUrl, {
          targetTokenBudget: 15000,
          maxAttempts: 2,
          enableProgressiveFallback: true,
        });
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / 50;

      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.compressionAnalysis);
      console.log(
        `✓ Compression analysis: ${avgTime.toFixed(2)}ms avg (${PERFORMANCE_THRESHOLDS.compressionAnalysis}ms threshold)`,
      );
    });

    it('should handle large images within reasonable time', async () => {
      const largeImageDataUrl = testUtils.createMockImageDataUrl(100); // 100KB

      const startTime = performance.now();

      const result = await AdaptiveCompressor.compressForInline(largeImageDataUrl, {
        targetTokenBudget: 10000, // Tight budget requiring aggressive compression
        maxAttempts: 3,
        enableProgressiveFallback: true,
      });

      const endTime = performance.now();
      const processingTime = endTime - startTime;

      expect(processingTime).toBeLessThan(PERFORMANCE_THRESHOLDS.compressionAnalysis * 2); // Allow 2x for large images
      expect(result.success).toBe(true);
      console.log(`✓ Large image compression: ${processingTime.toFixed(2)}ms`);
    });
  });

  describe('Manifest Operations Performance', () => {
    it('should perform CRUD operations quickly', async () => {
      const startTime = performance.now();

      // Add entries
      for (let i = 0; i < 100; i++) {
        await ScreenshotManifest.addEntry({
          id: `perf-test-${i}`,
          url: `https://example.com/page-${i}`,
          filePath: `/path/screenshot-${i}.webp`,
          metadata: {
            width: 800,
            height: 600,
            format: 'webp' as const,
            fileSize: 15000,
            deliveryMode: 'file' as const,
          },
          timestamp: Date.now() + i,
          hash: `hash-${i}`,
        });
      }

      // Read operations
      for (let i = 0; i < 50; i++) {
        await manifest.getEntry(`perf-test-${i}`);
        await manifest.getRecentEntries(10);
      }

      // Update storage stats
      await manifest.getStorageStats();

      const endTime = performance.now();
      const totalTime = endTime - startTime;
      const avgTime = totalTime / 150; // 100 adds + 50 reads

      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.manifestOperations);
      console.log(
        `✓ Manifest operations: ${avgTime.toFixed(2)}ms avg (${PERFORMANCE_THRESHOLDS.manifestOperations}ms threshold)`,
      );
    });

    it('should handle deduplication efficiently', async () => {
      const duplicateEntries = Array.from({ length: 50 }, (_, i) => ({
        id: `dup-test-${i}`,
        url: 'https://example.com/duplicate',
        filePath: `/path/dup-${i}.webp`,
        metadata: {
          width: 800,
          height: 600,
          format: 'webp' as const,
          fileSize: 15000,
          deliveryMode: 'file' as const,
        },
        timestamp: Date.now() + i,
        hash: 'duplicate-hash', // Same hash for all
      }));

      const startTime = performance.now();

      for (const entry of duplicateEntries) {
        await ScreenshotManifest.addEntry(entry);
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / duplicateEntries.length;

      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.manifestOperations);
      console.log(`✓ Deduplication performance: ${avgTime.toFixed(2)}ms avg per duplicate`);
    });
  });

  describe('Smart Auto Mode Performance', () => {
    it('should make decisions quickly for various scenarios', async () => {
      const scenarios = [
        { size: 2, saveMode: 'auto' as const, budget: 20000 }, // Small, auto
        { size: 10, saveMode: 'auto' as const, budget: 15000 }, // Medium, tight budget
        { size: 50, saveMode: 'auto' as const, budget: 25000 }, // Large, normal budget
        { size: 5, saveMode: 'base64' as const, budget: 20000 }, // Explicit inline
        { size: 20, saveMode: 'file' as const, budget: 20000 }, // Explicit file
      ];

      const startTime = performance.now();

      for (const scenario of scenarios) {
        const imageDataUrl = testUtils.createMockImageDataUrl(scenario.size);

        await smartAutoMode.executeAutoMode(imageDataUrl, {
          url: 'https://example.com/perf-test',
          title: 'Performance Test',
          saveMode: scenario.saveMode,
          targetTokenBudget: scenario.budget,
          enableContentAnalysis: true,
        });
      }

      const endTime = performance.now();
      const avgTime = (endTime - startTime) / scenarios.length;

      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.smartModeDecision);
      console.log(
        `✓ Smart mode decisions: ${avgTime.toFixed(2)}ms avg (${PERFORMANCE_THRESHOLDS.smartModeDecision}ms threshold)`,
      );
    });

    it('should handle concurrent processing efficiently', async () => {
      const concurrentRequests = Array.from({ length: 10 }, (_, i) => ({
        imageDataUrl: testUtils.createMockImageDataUrl(5 + i), // Varying sizes
        params: {
          url: `https://example.com/concurrent-${i}`,
          title: `Concurrent Test ${i}`,
          saveMode: 'auto' as const,
          targetTokenBudget: 18000,
          enableContentAnalysis: true,
        },
      }));

      const startTime = performance.now();

      // Process all requests concurrently
      const results = await Promise.all(
        concurrentRequests.map((req) =>
          smartAutoMode.executeAutoMode(req.imageDataUrl, req.params),
        ),
      );

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.smartModeDecision * 3); // Allow 3x for concurrent processing
      expect(results.every((r) => r.success)).toBe(true);
      console.log(
        `✓ Concurrent processing: ${totalTime.toFixed(2)}ms for ${concurrentRequests.length} requests`,
      );
    });
  });

  describe('End-to-End Performance', () => {
    it('should complete full workflow within acceptable time', async () => {
      const testParams = {
        name: 'e2e-performance-test',
        storeBase64: false,
        savePng: true,
        width: 1920,
        height: 1080,
        fullPage: true,
      };

      const startTime = performance.now();

      // 1. Parameter normalization
      const normalized = configManager.normalizeParams(testParams);

      // 2. Create mock image data
      const imageDataUrl = testUtils.createMockImageDataUrl(25); // 25KB

      // 3. Execute smart auto mode
      const result = await smartAutoMode.executeAutoMode(imageDataUrl, {
        url: 'https://example.com/e2e-test',
        title: 'End-to-End Performance Test',
        width: normalized.width,
        height: normalized.height,
        saveMode: normalized.saveMode,
        fileFormat: normalized.fileFormat,
        targetTokenBudget: normalized.targetTokenBudget,
        enableContentAnalysis: true,
        storeBase64: testParams.storeBase64,
        savePng: testParams.savePng,
      });

      // 4. Verify result
      expect(result.success).toBe(true);

      const endTime = performance.now();
      const totalTime = endTime - startTime;

      expect(totalTime).toBeLessThan(PERFORMANCE_THRESHOLDS.endToEndProcessing);
      console.log(
        `✓ End-to-end processing: ${totalTime.toFixed(2)}ms (${PERFORMANCE_THRESHOLDS.endToEndProcessing}ms threshold)`,
      );
    });

    it('should maintain performance under load', async () => {
      const loadTestRequests = 20;
      const requests: Promise<any>[] = [];

      const startTime = performance.now();

      for (let i = 0; i < loadTestRequests; i++) {
        const imageSize = 5 + (i % 10); // Varying sizes 5-14KB
        const imageDataUrl = testUtils.createMockImageDataUrl(imageSize);

        const request = smartAutoMode.executeAutoMode(imageDataUrl, {
          url: `https://example.com/load-test-${i}`,
          title: `Load Test ${i}`,
          saveMode: 'auto',
          targetTokenBudget: 15000 + i * 500, // Varying budgets
          enableContentAnalysis: true,
        });

        requests.push(request);
      }

      const results = await Promise.all(requests);
      const endTime = performance.now();

      const totalTime = endTime - startTime;
      const avgTime = totalTime / loadTestRequests;

      expect(results.every((r) => r.success)).toBe(true);
      expect(avgTime).toBeLessThan(PERFORMANCE_THRESHOLDS.smartModeDecision * 2); // Allow 2x for load
      console.log(
        `✓ Load test: ${avgTime.toFixed(2)}ms avg for ${loadTestRequests} concurrent requests`,
      );
    });
  });

  describe('Memory Usage', () => {
    it('should not create memory leaks during repeated operations', async () => {
      const initialMemory = process.memoryUsage();

      // Perform many operations
      for (let i = 0; i < 100; i++) {
        const imageDataUrl = testUtils.createMockImageDataUrl(10);

        // Full workflow
        const normalized = configManager.normalizeParams({
          name: `memory-test-${i}`,
          saveMode: 'auto',
          targetTokenBudget: 18000,
        });

        await smartAutoMode.executeAutoMode(imageDataUrl, {
          url: `https://example.com/memory-${i}`,
          saveMode: normalized.saveMode,
          targetTokenBudget: normalized.targetTokenBudget,
        });

        // Periodic cleanup
        if (i % 20 === 0) {
          global.gc?.(); // Force garbage collection if available
        }
      }

      const finalMemory = process.memoryUsage();
      const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const heapGrowthMB = heapGrowth / (1024 * 1024);

      // Should not grow more than 50MB during test
      expect(heapGrowthMB).toBeLessThan(50);
      console.log(`✓ Memory growth: ${heapGrowthMB.toFixed(2)}MB (50MB threshold)`);
    });
  });

  describe('Performance Regression Detection', () => {
    it('should maintain consistent performance across runs', async () => {
      const runs = 5;
      const timings: number[] = [];

      for (let run = 0; run < runs; run++) {
        const startTime = performance.now();

        // Standard workflow
        const imageDataUrl = testUtils.createMockImageDataUrl(10);
        await smartAutoMode.executeAutoMode(imageDataUrl, {
          url: 'https://example.com/regression-test',
          saveMode: 'auto',
          targetTokenBudget: 18000,
          enableContentAnalysis: true,
        });

        const endTime = performance.now();
        timings.push(endTime - startTime);
      }

      const avgTime = timings.reduce((a, b) => a + b, 0) / timings.length;
      const maxTime = Math.max(...timings);
      const minTime = Math.min(...timings);
      const variance = maxTime - minTime;

      // Performance should be consistent (variance < 50% of average)
      expect(variance).toBeLessThan(avgTime * 0.5);
      console.log(
        `✓ Performance consistency: ${avgTime.toFixed(2)}ms avg, ${variance.toFixed(2)}ms variance`,
      );
    });
  });
});
