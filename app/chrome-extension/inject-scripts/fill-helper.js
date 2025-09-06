/* eslint-disable */
// fill-helper.js
// This script is injected into the page to handle form filling operations

if (window.__FILL_HELPER_INITIALIZED__) {
  // Already initialized, skip
} else {
  window.__FILL_HELPER_INITIALIZED__ = true;
  /**
   * Fill an input element with the specified value
   * @param {string} selector - CSS selector for the element to fill
   * @param {string} value - Value to fill into the element
   * @returns {Promise<Object>} - Result of the fill operation
   */
  async function fillElement(selector, value) {
    try {
      // Find the element
      const element = document.querySelector(selector);
      if (!element) {
        return {
          error: `Element with selector "${selector}" not found`,
        };
      }

      // Get element information
      const rect = element.getBoundingClientRect();
      const elementInfo = {
        tagName: element.tagName,
        id: element.id,
        className: element.className,
        type: element.type || null,
        isVisible: isElementVisible(element),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
        },
      };

      // Check if element is visible
      if (!elementInfo.isVisible) {
        return {
          error: `Element with selector "${selector}" is not visible`,
          elementInfo,
        };
      }

      // Check if element is an input, textarea, or select
      const validTags = ['INPUT', 'TEXTAREA', 'SELECT'];
      const validInputTypes = [
        'text',
        'email',
        'password',
        'number',
        'search',
        'tel',
        'url',
        'date',
        'datetime-local',
        'month',
        'time',
        'week',
        'color',
      ];

      if (!validTags.includes(element.tagName)) {
        return {
          error: `Element with selector "${selector}" is not a fillable element (must be INPUT, TEXTAREA, or SELECT)`,
          elementInfo,
        };
      }

      // For input elements, check if the type is valid
      if (
        element.tagName === 'INPUT' &&
        !validInputTypes.includes(element.type) &&
        element.type !== null
      ) {
        return {
          error: `Input element with selector "${selector}" has type "${element.type}" which is not fillable`,
          elementInfo,
        };
      }

      // Scroll element into view
      element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Focus the element
      element.focus();

      // Fill the element based on its type
      if (element.tagName === 'SELECT') {
        // For select elements, find the option with matching value or text
        let optionFound = false;
        for (const option of element.options) {
          if (option.value === value || option.text === value) {
            element.value = option.value;
            optionFound = true;
            break;
          }
        }

        if (!optionFound) {
          return {
            error: `No option with value or text "${value}" found in select element`,
            elementInfo,
          };
        }

        // Trigger change event
        element.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        // For input and textarea elements

        // Clear the current value
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));

        // Set the new value
        element.value = value;

        // Trigger input and change events
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Blur the element
      element.blur();

      // Check for modal dialogs after filling
      await new Promise((resolve) => setTimeout(resolve, 200)); // Brief delay for modal to appear
      const modalDetection = await waitForModalChange(2000, true); // Wait up to 2 seconds for modal

      return {
        success: true,
        message: 'Element filled successfully',
        elementInfo: {
          ...elementInfo,
          value: element.value, // Include the final value in the response
        },
        modalDetection,
      };
    } catch (error) {
      return {
        error: `Error filling element: ${error.message}`,
      };
    }
  }

  /**
   * Check if an element is visible
   * @param {Element} element - The element to check
   * @returns {boolean} - Whether the element is visible
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

    // Check if element is within viewport
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }

    // Check if element is actually visible at its center point
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const elementAtPoint = document.elementFromPoint(centerX, centerY);
    if (!elementAtPoint) return false;

    return element === elementAtPoint || element.contains(elementAtPoint);
  }

  /**
   * Detect modal dialogs currently visible on the page
   * @returns {Array} Array of modal information objects
   */
  function detectModalDialogs() {
    const modals = [];

    // Common modal selectors
    const modalSelectors = [
      '[aria-modal="true"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '.modal',
      '.popup',
      '.overlay',
      // Gmail-specific selectors
      '.nH .aOd', // Gmail modal dialog container
      '.vE', // Gmail confirmation dialog
      '[data-ismodal="true"]',
    ];

    modalSelectors.forEach((selector) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element) => {
        if (isElementVisible(element)) {
          const modal = extractModalInfo(element);
          if (modal && !modals.find((m) => m.element === element)) {
            modals.push(modal);
          }
        }
      });
    });

    return modals;
  }

  /**
   * Extract information from a modal dialog element
   * @param {Element} element - The modal element
   * @returns {Object|null} Modal information object
   */
  function extractModalInfo(element) {
    if (!element || !isElementVisible(element)) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const text = element.textContent?.trim() || '';

    // Find buttons in the modal
    const buttons = [];
    const buttonSelectors = [
      'button',
      '[role="button"]',
      'input[type="button"]',
      'input[type="submit"]',
      '.button',
      // Gmail-specific button selectors
      '.T-I', // Gmail button class
      '[data-tooltip]', // Gmail buttons often have tooltips
    ];

    buttonSelectors.forEach((btnSelector) => {
      const btnElements = element.querySelectorAll(btnSelector);
      btnElements.forEach((btn) => {
        if (isElementVisible(btn)) {
          buttons.push({
            text: btn.textContent?.trim() || btn.value || btn.getAttribute('aria-label') || '',
            selector: getElementSelector(btn),
            className: btn.className,
            type: btn.type || 'button',
          });
        }
      });
    });

    // Determine modal type
    let modalType = 'custom';
    if (element.getAttribute('role') === 'alertdialog' || text.toLowerCase().includes('confirm')) {
      modalType = 'confirmation';
    } else if (element.getAttribute('role') === 'dialog') {
      modalType = 'dialog';
    } else if (text.toLowerCase().includes('alert') || text.toLowerCase().includes('warning')) {
      modalType = 'alert';
    }

    return {
      element: element,
      type: modalType,
      message: text.substring(0, 500), // Limit message length
      buttons: buttons,
      selector: getElementSelector(element),
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      },
      ariaModal: element.getAttribute('aria-modal'),
      role: element.getAttribute('role'),
      className: element.className,
    };
  }

  /**
   * Generate a unique selector for an element
   * @param {Element} element - The element to generate selector for
   * @returns {string} CSS selector string
   */
  function getElementSelector(element) {
    if (!element) return '';

    if (element.id) {
      return `#${element.id}`;
    }

    let selector = element.tagName.toLowerCase();

    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).slice(0, 3); // Limit to 3 classes
      if (classes.length > 0 && classes[0]) {
        selector += '.' + classes.join('.');
      }
    }

    // Add nth-child if needed for uniqueness
    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.tagName === element.tagName && child.className === element.className,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(element) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    return selector;
  }

  /**
   * Wait for modal dialog to appear or disappear
   * @param {number} timeout - Maximum time to wait in milliseconds
   * @param {boolean} waitForAppearance - If true, wait for modal to appear; if false, wait for modal to disappear
   * @returns {Promise<Object>} Promise that resolves with modal state
   */
  function waitForModalChange(timeout = 5000, waitForAppearance = true) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const initialModals = detectModalDialogs();

      const checkModal = () => {
        const currentModals = detectModalDialogs();
        const hasModals = currentModals.length > 0;
        const modalChanged = waitForAppearance ? hasModals : !hasModals;

        if (modalChanged || Date.now() - startTime >= timeout) {
          resolve({
            success: modalChanged,
            modals: currentModals,
            timeout: Date.now() - startTime >= timeout,
            waitedFor: waitForAppearance ? 'appearance' : 'disappearance',
          });
          return;
        }

        setTimeout(checkModal, 100); // Check every 100ms
      };

      // Start checking after a small delay
      setTimeout(checkModal, 50);
    });
  }

  // Listen for messages from the extension
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'fillElement') {
      fillElement(request.selector, request.value)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            error: `Unexpected error: ${error.message}`,
          });
        });
      return true; // Indicates async response
    } else if (request.action === 'detectModals') {
      try {
        const modals = detectModalDialogs();
        sendResponse({
          success: true,
          modals: modals.map((modal) => ({
            ...modal,
            element: undefined, // Remove element reference for serialization
          })),
        });
      } catch (error) {
        sendResponse({
          error: `Error detecting modals: ${error.message}`,
        });
      }
      return false;
    } else if (request.action === 'waitForModalChange') {
      waitForModalChange(request.timeout || 5000, request.waitForAppearance !== false)
        .then((result) => {
          sendResponse({
            success: true,
            ...result,
            modals: result.modals.map((modal) => ({
              ...modal,
              element: undefined, // Remove element reference for serialization
            })),
          });
        })
        .catch((error) => {
          sendResponse({
            error: `Error waiting for modal change: ${error.message}`,
          });
        });
      return true; // Indicates async response
    } else if (request.action === 'chrome_fill_or_select_ping') {
      sendResponse({ status: 'pong' });
      return false;
    }
  });
}
