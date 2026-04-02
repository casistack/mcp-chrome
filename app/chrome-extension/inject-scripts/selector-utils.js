/* eslint-disable no-undef */
// selector-utils.js
// Enhanced selector utilities for robust element finding across complex web applications

/**
 * Normalize and generate fallback selectors for dynamic/problematic selectors
 * @param {string} originalSelector - The original selector that might be problematic
 * @returns {Array<string>} Array of selector candidates to try in order
 */
function generateSelectorCandidates(originalSelector) {
  const candidates = [];

  // Handle colon-prefixed IDs (common in Gmail, Angular, React apps)
  if (originalSelector.includes(':') && originalSelector.startsWith('#')) {
    const idPart = originalSelector.substring(1); // Remove #

    // Strategy 1: Attribute selector (most reliable)
    candidates.push(`[id="${idPart}"]`);

    // Strategy 2: Properly escaped CSS selector
    candidates.push(`#${CSS.escape(idPart)}`);

    // Strategy 3: Manual escaping for older browsers
    const manualEscaped = '#' + idPart.replace(/:/g, '\\:');
    candidates.push(manualEscaped);

    // Strategy 4: Try the original in case it works
    candidates.push(originalSelector);
  }
  // Handle double-escaped selectors (fix common automation mistakes)
  else if (originalSelector.includes('\\\\:')) {
    const cleaned = originalSelector.replace(/\\\\:/g, ':');
    candidates.push(...generateSelectorCandidates(cleaned));
  }
  // Standard selector - still add fallbacks
  else {
    candidates.push(originalSelector);
  }

  return [...new Set(candidates)]; // Remove duplicates
}

/**
 * Find element using multiple strategies with timeout and retry logic
 * @param {string} selector - CSS selector or element description
 * @param {Object} options - Configuration options
 * @returns {Promise<Element|null>} Found element or null
 */
async function findElementRobustly(selector, options = {}) {
  const {
    timeout = 5000,
    retryInterval = 100,
    contextElement = document,
    requireVisible = true,
    fallbackStrategies = true,
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Strategy 1: Try selector candidates
    const candidates = generateSelectorCandidates(selector);

    for (const candidate of candidates) {
      try {
        const element = contextElement.querySelector(candidate);
        if (element && (!requireVisible || isElementVisible(element))) {
          return element;
        }
      } catch (error) {
        // Invalid selector, continue to next candidate
        console.debug(`Invalid selector candidate: ${candidate}`, error);
      }
    }

    // Strategy 2: Fallback strategies if enabled
    if (fallbackStrategies) {
      // Try finding by aria-label if selector looks like it could be a label
      if (selector.toLowerCase().includes('send') || selector.toLowerCase().includes('submit')) {
        const byAriaLabel = contextElement.querySelector(
          '[aria-label*="Send" i], [aria-label*="Submit" i]',
        );
        if (byAriaLabel && (!requireVisible || isElementVisible(byAriaLabel))) {
          return byAriaLabel;
        }
      }

      // Try finding by role and text content
      if (selector.toLowerCase().includes('button')) {
        const buttons = contextElement.querySelectorAll('button, [role="button"]');
        for (const button of buttons) {
          const text = button.textContent?.trim().toLowerCase();
          if (text && selector.toLowerCase().includes(text)) {
            if (!requireVisible || isElementVisible(button)) {
              return button;
            }
          }
        }
      }

      // Try finding input fields by type/purpose
      if (selector.toLowerCase().includes('recipient') || selector.toLowerCase().includes('to')) {
        const inputs = contextElement.querySelectorAll(
          'input[aria-label*="recipient" i], input[aria-label*="to" i], input[name*="to" i]',
        );
        for (const input of inputs) {
          if (!requireVisible || isElementVisible(input)) {
            return input;
          }
        }
      }

      if (selector.toLowerCase().includes('subject')) {
        const subjectInputs = contextElement.querySelectorAll(
          'input[aria-label*="subject" i], input[name*="subject" i], input[placeholder*="subject" i]',
        );
        for (const input of subjectInputs) {
          if (!requireVisible || isElementVisible(input)) {
            return input;
          }
        }
      }
    }

    // Wait before next retry
    await new Promise((resolve) => setTimeout(resolve, retryInterval));
  }

  return null;
}

/**
 * Enhanced element visibility check
 * @param {Element} element - Element to check
 * @returns {boolean} Whether element is truly visible and interactable
 */
function isElementVisible(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  // Check if element is within viewport or scrollable area
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

  if (
    rect.bottom < -100 ||
    rect.top > viewportHeight + 100 ||
    rect.right < -100 ||
    rect.left > viewportWidth + 100
  ) {
    // Allow some margin for elements slightly outside viewport
    return false;
  }

  // Check if element is actually clickable at its center point
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const elementAtPoint = document.elementFromPoint(centerX, centerY);
  if (!elementAtPoint) return false;

  return (
    element === elementAtPoint ||
    element.contains(elementAtPoint) ||
    elementAtPoint.contains(element)
  );
}

/**
 * Enhanced form field interaction with smart confirmation
 * @param {Element} element - Input element to fill
 * @param {string} value - Value to set
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} Success status
 */
async function fillFieldRobustly(element, value, options = {}) {
  const { confirmEntry = false, simulateTyping = false, triggerEvents = true } = options;

  if (!element) return false;

  try {
    // Focus the element
    element.focus();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Check if element is contenteditable
    const isContentEditable =
      element.isContentEditable ||
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('contenteditable') === '';

    if (isContentEditable) {
      // Handle contenteditable elements (like Gmail compose body)
      element.innerHTML = '';

      if (simulateTyping) {
        // Simulate typing for contenteditable elements
        for (const char of value) {
          if (char === '\n') {
            element.innerHTML += '<br>';
          } else {
            element.innerHTML += char;
          }
          if (triggerEvents) {
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 10));
        }
      } else {
        // Fast fill for contenteditable
        const htmlContent = value.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
        element.innerHTML = `<div>${htmlContent}</div>`;
      }

      if (triggerEvents) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Move cursor to end for contenteditable
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(element);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (simulateTyping) {
      // Simulate realistic typing for regular input fields
      element.value = '';
      for (const char of value) {
        element.value += char;
        if (triggerEvents) {
          element.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keypress', { key: char, bubbles: true }));
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
        }
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 50 + 10));
      }
    } else {
      // Fast fill for regular inputs
      element.value = value;
      if (triggerEvents) {
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Auto-confirm entry if requested (useful for recipient fields, search fields, etc.)
    if (confirmEntry) {
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Try Enter key
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }),
      );
      element.dispatchEvent(
        new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }),
      );
      element.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', keyCode: 13, bubbles: true }),
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      // Also try Tab for good measure in some applications
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true }),
      );
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', keyCode: 9, bubbles: true }));
    }

    return true;
  } catch (error) {
    console.error('Error filling field:', error);
    return false;
  }
}

/**
 * Smart click with retry and fallback strategies
 * @param {Element} element - Element to click
 * @param {Object} options - Configuration options
 * @returns {Promise<boolean>} Success status
 */
async function clickElementRobustly(element, options = {}) {
  const { retries = 3, scrollIntoView = true, waitBetweenRetries = 500 } = options;

  if (!element) return false;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      if (scrollIntoView) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Multiple click strategies
      const strategies = [
        // Strategy 1: Standard click
        () => element.click(),

        // Strategy 2: Mouse event simulation
        () => {
          const rect = element.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;

          ['mousedown', 'mouseup', 'click'].forEach((eventType) => {
            element.dispatchEvent(
              new MouseEvent(eventType, {
                view: window,
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y,
              }),
            );
          });
        },

        // Strategy 3: Focus + Enter/Space
        () => {
          element.focus();
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        },
      ];

      for (const strategy of strategies) {
        try {
          strategy();
          await new Promise((resolve) => setTimeout(resolve, 100));

          // Check if click was successful (element state changed, modal appeared, etc.)
          if (await verifyClickSuccess(element)) {
            return true;
          }
        } catch (strategyError) {
          console.debug(`Click strategy failed:`, strategyError);
        }
      }

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, waitBetweenRetries));
      }
    } catch (error) {
      console.error(`Click attempt ${attempt} failed:`, error);
    }
  }

  return false;
}

/**
 * Verify if click was successful by checking for common success indicators
 * @param {Element} element - The clicked element
 * @returns {Promise<boolean>} Whether click appears successful
 */
async function verifyClickSuccess(element) {
  // Wait a bit for changes to occur
  await new Promise((resolve) => setTimeout(resolve, 300));

  // Check for common success indicators
  const indicators = [
    // Modal appeared
    () => document.querySelector('[role="dialog"], [aria-modal="true"], .modal') !== null,

    // Element state changed
    () =>
      element.classList.contains('active') ||
      element.classList.contains('clicked') ||
      element.disabled,

    // Focus changed
    () => document.activeElement !== element,

    // Page navigation started
    () => document.readyState === 'loading',

    // Form submitted (action attribute or method present)
    () => {
      const form = element.closest('form');
      return form && (form.action !== window.location.href || form.method.toLowerCase() === 'post');
    },
  ];

  return indicators.some((indicator) => {
    try {
      return indicator();
    } catch {
      return false;
    }
  });
}

// Export utilities for use in other scripts
if (typeof window !== 'undefined') {
  window.__SELECTOR_UTILS__ = {
    generateSelectorCandidates,
    findElementRobustly,
    isElementVisible,
    fillFieldRobustly,
    clickElementRobustly,
    verifyClickSuccess,
  };
}
