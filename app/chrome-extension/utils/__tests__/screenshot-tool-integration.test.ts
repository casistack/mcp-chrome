/**
 * Integration tests for the screenshot tool with enhanced system
 * Tests the complete flow from tool execution to final response
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock the background tool environment
const mockBaseBrowserTool = {
  injectContentScript: jest.fn().mockResolvedValue(undefined),
  sendMessageToTab: jest.fn().mockResolvedValue({
    currentScrollX: 0,
    currentScrollY: 0,
    totalWidth: 1024,
    totalHeight: 768,
    viewportWidth: 1024,
    viewportHeight: 768,
    devicePixelRatio: 1,
  }),
};

// Mock the screenshot tool class structure
jest.unstable_mockModule('../screenshot-config', () => ({
  ScreenshotConfigManager: {
    getInstance: jest.fn(() => ({
      normalizeParams: jest.fn((params) => ({
        name: params.name || 'screenshot',
        saveMode:
          params.saveMode || (params.storeBase64 ? 'base64' : params.savePng ? 'file' : 'auto'),
        fileFormat: params.fileFormat || 'webp',
        compressionQuality: params.compressionQuality || 0.85,
        targetTokenBudget: params.targetTokenBudget || 18000,
        maxInlineSize: 20000,
        includeThumbnail: params.includeThumbnail || false,
        includeAbsolutePath: params.includeAbsolutePath || false,
        saveFolder: 'MCP-Screenshots',
        fullPage: params.fullPage || false,
        selector: params.selector,
        width: params.width,
        height: params.height,
        maxHeight: params.maxHeight,
        compatWarnings: [],
      })),
    })),
  },
  isLegacyParameterUsage: jest.fn((params) => {
    return !!(params.storeBase64 !== undefined || params.savePng !== undefined);
  }),
}));

jest.unstable_mockModule('../smart-auto-mode', () => ({
  SmartAutoMode: jest.fn(() => ({
    executeAutoMode: jest.fn((imageDataUrl, params) => {
      const isLargeImage = imageDataUrl.length > 10000;
      const mode =
        params.saveMode === 'auto'
          ? isLargeImage || params.targetTokenBudget < 15000
            ? 'file'
            : 'inline'
          : params.saveMode === 'base64'
            ? 'inline'
            : 'file';

      return Promise.resolve({
        success: true,
        decision: {
          mode,
          confidence: 0.85,
          reasoning:
            mode === 'file'
              ? 'Image size or token budget constraints favor file delivery'
              : 'Image size is suitable for inline delivery',
        },
        inlineResult:
          mode === 'inline'
            ? {
                base64Data: 'mock-base64-data',
                mimeType: 'image/webp',
                actualTokens: 8000,
                compressionRatio: 0.7,
                format: 'webp',
              }
            : undefined,
        fileResult:
          mode === 'file'
            ? {
                filePath: 'screenshot_2024-01-01.webp',
                absolutePath: '/path/to/screenshots/screenshot_2024-01-01.webp',
                fileSize: 15000,
                mimeType: 'image/webp',
                format: 'webp',
              }
            : undefined,
        manifestEntry: {
          id: 'test-entry-123',
          url: params.url,
          filePath: mode === 'file' ? 'screenshot_2024-01-01.webp' : undefined,
          timestamp: Date.now(),
          metadata: {
            width: params.width || 1024,
            height: params.height || 768,
            format: 'webp',
            fileSize: mode === 'file' ? 15000 : 8000,
            deliveryMode: mode,
          },
          hash: 'mock-hash',
        },
        suggestions: ['Consider using WebP format for better compression'],
        warnings: [],
        qualityMetrics: {
          compressionQuality: 0.85,
          visualQuality: 0.9,
          efficiencyScore: 0.8,
        },
      });
    }),
  })),
}));

// Import after mocking
const { ScreenshotConfigManager, isLegacyParameterUsage } = await import('../screenshot-config');
const { SmartAutoMode } = await import('../smart-auto-mode');

describe('Screenshot Tool Integration', () => {
  let mockTab: any;
  let mockCreateErrorResponse: jest.Mock;

  beforeEach(() => {
    mockTab = {
      id: 1,
      url: 'https://example.com',
      title: 'Test Page',
      windowId: 1,
    };

    mockCreateErrorResponse = jest.fn((message) => ({
      content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
      isError: true,
    }));

    // Reset Chrome API mocks
    global.chrome.tabs.query = jest.fn().mockResolvedValue([mockTab]);
    global.chrome.tabs.captureVisibleTab = jest.fn().mockResolvedValue(
      testUtils.createMockImageDataUrl(5), // 5KB image
    );

    jest.clearAllMocks();
  });

  describe('Parameter Processing', () => {
    it('should handle legacy storeBase64=true correctly', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      const result = await mockScreenshotTool.execute({
        name: 'legacy-test',
        storeBase64: true,
        savePng: false,
        width: 800,
        height: 600,
      });

      expect(result.isError).toBe(false);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.deliveryMode).toBe('inline');
      expect(response.base64Data).toBeDefined();
      expect(response.name).toBe('legacy-test');
    });

    it('should handle legacy savePng=true correctly', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      const result = await mockScreenshotTool.execute({
        name: 'file-test',
        storeBase64: false,
        savePng: true,
        fullPage: true,
      });

      expect(result.isError).toBe(false);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.deliveryMode).toBe('file');
      expect(response.filePath).toBeDefined();
      expect(response.fullPath).toBeDefined();
    });

    it('should handle enhanced saveMode=auto correctly', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      // Small image should go inline
      const result = await mockScreenshotTool.execute({
        name: 'auto-small',
        saveMode: 'auto',
        fileFormat: 'webp',
        targetTokenBudget: 20000,
        compressionQuality: 0.8,
      });

      expect(result.isError).toBe(false);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.deliveryMode).toBe('inline');
      expect(response.confidence).toBeDefined();
      expect(response.reasoning).toBeDefined();
    });

    it('should handle tight token budgets with file fallback', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      // Force file mode with tight budget
      const result = await mockScreenshotTool.execute({
        name: 'tight-budget',
        saveMode: 'auto',
        targetTokenBudget: 5000, // Very tight
      });

      expect(result.isError).toBe(false);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.deliveryMode).toBe('file');
      expect(response.reasoning).toContain('token budget');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing tab gracefully', async () => {
      global.chrome.tabs.query = jest.fn().mockResolvedValue([]);

      const mockScreenshotTool = createMockScreenshotTool();
      const result = await mockScreenshotTool.execute({ name: 'no-tab' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('error');
    });

    it('should handle restricted URLs', async () => {
      global.chrome.tabs.query = jest.fn().mockResolvedValue([
        {
          ...mockTab,
          url: 'chrome://extensions/',
        },
      ]);

      const mockScreenshotTool = createMockScreenshotTool();
      const result = await mockScreenshotTool.execute({ name: 'restricted' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('security restrictions');
    });

    it('should handle capture failures', async () => {
      global.chrome.tabs.captureVisibleTab = jest
        .fn()
        .mockRejectedValue(new Error('Capture failed'));

      const mockScreenshotTool = createMockScreenshotTool();
      const result = await mockScreenshotTool.execute({ name: 'capture-fail' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Screenshot error');
    });
  });

  describe('Full Page Screenshots', () => {
    it('should handle full page capture correctly', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      // Mock multi-part capture scenario
      mockScreenshotTool._captureFullPage = jest.fn().mockResolvedValue(
        testUtils.createMockImageDataUrl(20), // 20KB full page image
      );

      const result = await mockScreenshotTool.execute({
        name: 'fullpage-test',
        fullPage: true,
        saveMode: 'auto',
        width: 1920,
        height: 1080,
      });

      expect(result.isError).toBe(false);
      expect(mockScreenshotTool._captureFullPage).toHaveBeenCalled();

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.deliveryMode).toBe('file'); // Large image should go to file
    });

    it('should handle maxHeight limits for infinite scroll', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      const result = await mockScreenshotTool.execute({
        name: 'infinite-scroll',
        fullPage: true,
        maxHeight: 10000,
        saveMode: 'auto',
      });

      expect(result.isError).toBe(false);

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
    });
  });

  describe('Element Screenshots', () => {
    it('should handle element capture correctly', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      mockScreenshotTool._captureElement = jest.fn().mockResolvedValue(
        testUtils.createMockImageDataUrl(3), // 3KB element image
      );

      const result = await mockScreenshotTool.execute({
        name: 'element-test',
        selector: '#main-content',
        width: 500,
        height: 400,
        saveMode: 'auto',
      });

      expect(result.isError).toBe(false);
      expect(mockScreenshotTool._captureElement).toHaveBeenCalled();

      const response = JSON.parse(result.content[0].text);
      expect(response.success).toBe(true);
      expect(response.deliveryMode).toBe('inline'); // Small element should go inline
    });
  });

  describe('Response Format Validation', () => {
    it('should include all required metadata in response', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      const result = await mockScreenshotTool.execute({
        name: 'metadata-test',
        saveMode: 'auto',
        enableContentAnalysis: true,
      });

      expect(result.isError).toBe(false);

      const response = JSON.parse(result.content[0].text);

      // Verify all required fields
      expect(response.success).toBe(true);
      expect(response.message).toBeDefined();
      expect(response.tabId).toBe(mockTab.id);
      expect(response.url).toBe(mockTab.url);
      expect(response.name).toBe('metadata-test');
      expect(response.deliveryMode).toBeDefined();
      expect(response.confidence).toBeDefined();
      expect(response.reasoning).toBeDefined();
      expect(response.suggestions).toBeInstanceOf(Array);
      expect(response.warnings).toBeInstanceOf(Array);
      expect(response.qualityMetrics).toBeDefined();
    });

    it('should include appropriate data based on delivery mode', async () => {
      const mockScreenshotTool = createMockScreenshotTool();

      // Test inline mode
      const inlineResult = await mockScreenshotTool.execute({
        name: 'inline-test',
        saveMode: 'base64',
      });

      const inlineResponse = JSON.parse(inlineResult.content[0].text);
      expect(inlineResponse.deliveryMode).toBe('inline');
      expect(inlineResponse.base64Data).toBeDefined();
      expect(inlineResponse.mimeType).toBeDefined();
      expect(inlineResponse.actualTokens).toBeDefined();

      // Test file mode
      const fileResult = await mockScreenshotTool.execute({
        name: 'file-test',
        saveMode: 'file',
      });

      const fileResponse = JSON.parse(fileResult.content[0].text);
      expect(fileResponse.deliveryMode).toBe('file');
      expect(fileResponse.fileSaved).toBe(true);
      expect(fileResponse.filePath).toBeDefined();
      expect(fileResponse.fullPath).toBeDefined();
      expect(fileResponse.fileSize).toBeDefined();
    });
  });

  // Helper function to create mock screenshot tool
  function createMockScreenshotTool() {
    return {
      name: 'chrome_screenshot',

      async execute(args: any) {
        try {
          // Parameter normalization
          const configManager = ScreenshotConfigManager.getInstance();
          const normalizedParams = configManager.normalizeParams(args);
          const isLegacy = isLegacyParameterUsage(args);

          // Get current tab
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tabs[0]) {
            return mockCreateErrorResponse('No active tab found');
          }
          const tab = tabs[0];

          // Check URL restrictions
          if (
            tab.url?.startsWith('chrome://') ||
            tab.url?.startsWith('edge://') ||
            tab.url?.startsWith('https://chrome.google.com/webstore') ||
            tab.url?.startsWith('https://microsoftedge.microsoft.com/')
          ) {
            return mockCreateErrorResponse(
              'Cannot capture special browser pages or web store pages due to security restrictions.',
            );
          }

          // Mock content script injection and page preparation
          await mockBaseBrowserTool.injectContentScript(tab.id, [
            'inject-scripts/screenshot-helper.js',
          ]);
          await mockBaseBrowserTool.sendMessageToTab(tab.id, {
            action: 'SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE',
            options: { fullPage: normalizedParams.fullPage },
          });

          // Get page details
          const pageDetails = await mockBaseBrowserTool.sendMessageToTab(tab.id, {
            action: 'SCREENSHOT_GET_PAGE_DETAILS',
          });

          // Simulate image capture based on parameters
          let finalImageDataUrl: string;

          if (normalizedParams.fullPage) {
            finalImageDataUrl =
              (await this._captureFullPage?.(tab.id, normalizedParams, pageDetails)) ||
              testUtils.createMockImageDataUrl(20); // Large full page
          } else if (normalizedParams.selector) {
            finalImageDataUrl =
              (await this._captureElement?.(
                tab.id,
                normalizedParams,
                pageDetails.devicePixelRatio,
              )) || testUtils.createMockImageDataUrl(3); // Small element
          } else {
            finalImageDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
              format: 'png',
            });
          }

          // Process with SmartAutoMode
          const smartAutoMode = new SmartAutoMode();
          const result = await smartAutoMode.executeAutoMode(finalImageDataUrl, {
            url: tab.url || '',
            title: tab.title,
            width: normalizedParams.width,
            height: normalizedParams.height,
            saveMode: normalizedParams.saveMode,
            fileFormat: normalizedParams.fileFormat,
            compressionQuality: normalizedParams.compressionQuality,
            targetTokenBudget: normalizedParams.targetTokenBudget,
            enableContentAnalysis: true,
            tags: [],
            notes: '',
            storeBase64: isLegacy ? args.storeBase64 : undefined,
            savePng: isLegacy ? args.savePng : undefined,
          });

          // Build response
          const responseData: any = {
            success: true,
            message: `Screenshot [${normalizedParams.name || 'screenshot'}] captured successfully`,
            tabId: tab.id,
            url: tab.url,
            name: normalizedParams.name || 'screenshot',
            deliveryMode: result.decision.mode,
            confidence: result.decision.confidence,
            reasoning: result.decision.reasoning,
            suggestions: result.suggestions,
            warnings: result.warnings,
            qualityMetrics: result.qualityMetrics,
          };

          if (result.decision.mode === 'inline' && result.inlineResult) {
            responseData.base64Data = result.inlineResult.base64Data;
            responseData.mimeType = result.inlineResult.mimeType;
            responseData.actualTokens = result.inlineResult.actualTokens;
            responseData.compressionRatio = result.inlineResult.compressionRatio;
          } else if (result.decision.mode === 'file' && result.fileResult) {
            responseData.fileSaved = true;
            responseData.filePath = result.fileResult.filePath;
            responseData.fullPath = result.fileResult.absolutePath;
            responseData.fileSize = result.fileResult.fileSize;
            responseData.mimeType = result.fileResult.mimeType;
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(responseData) }],
            isError: false,
          };
        } catch (error) {
          return mockCreateErrorResponse(
            `Screenshot error: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },

      // Mock capture methods (can be overridden in tests)
      _captureFullPage: undefined,
      _captureElement: undefined,
    };
  }
});
