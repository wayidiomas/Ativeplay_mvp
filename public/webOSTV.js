/**
 * webOSTV.js - LG webOS TV Platform Bridge
 * Provides access to Luna Service APIs for webOS applications
 * Based on official LG webOS SDK
 */

(function(window) {
  'use strict';

  // If webOS is already defined by the native SDK, don't overwrite
  if (window.webOS && window.webOS.service && window.webOS.service.request) {
    console.log('[webOSTV] Native webOS SDK already available, using existing implementation');
    return;
  }

  // Only initialize on actual webOS devices
  var isWebOS = (function() {
    var ua = navigator.userAgent || '';
    return ua.indexOf('Web0S') !== -1 ||
           ua.indexOf('webOS') !== -1 ||
           ua.indexOf('NetCast') !== -1 ||
           ua.indexOf('SmartTV') !== -1 ||
           (typeof window.PalmSystem !== 'undefined') ||
           (typeof window.PalmServiceBridge !== 'undefined');
  })();

  if (!isWebOS) {
    console.log('[webOSTV] Not running on webOS device');
    return;
  }

  console.log('[webOSTV] Initializing webOS bridge (no native SDK found)...');

  // Luna Service Bridge
  var PalmServiceBridge = window.PalmServiceBridge;
  var requestId = 0;
  var subscriptions = {};

  /**
   * Make a Luna Service request
   */
  function request(uri, params) {
    params = params || {};
    var method = params.method || '';
    var parameters = params.parameters || {};
    var onSuccess = params.onSuccess || function() {};
    var onFailure = params.onFailure || function() {};
    var subscribe = params.subscribe || false;

    var fullUri = uri;
    if (method) {
      fullUri = uri + '/' + method;
    }

    if (!PalmServiceBridge) {
      console.error('[webOSTV] PalmServiceBridge not available');
      onFailure({ errorCode: -1, errorText: 'PalmServiceBridge not available' });
      return null;
    }

    var bridge = new PalmServiceBridge();
    var reqId = ++requestId;

    bridge.onservicecallback = function(response) {
      try {
        var data = JSON.parse(response);
        if (data.errorCode || data.returnValue === false) {
          console.error('[webOSTV] Luna error:', fullUri, data);
          onFailure(data);
        } else {
          onSuccess(data);
        }
      } catch (e) {
        console.error('[webOSTV] Parse error:', e);
        onFailure({ errorCode: -1, errorText: 'Parse error: ' + e.message });
      }

      // Clean up non-subscription bridges
      if (!subscribe) {
        bridge = null;
      }
    };

    var payload = JSON.stringify(parameters);
    console.log('[webOSTV] Request:', fullUri, payload);

    try {
      bridge.call(fullUri, payload);
    } catch (e) {
      console.error('[webOSTV] Call error:', e);
      onFailure({ errorCode: -1, errorText: 'Call error: ' + e.message });
      return null;
    }

    if (subscribe) {
      subscriptions[reqId] = bridge;
      return {
        cancel: function() {
          if (subscriptions[reqId]) {
            subscriptions[reqId].cancel();
            delete subscriptions[reqId];
          }
        }
      };
    }

    return { cancel: function() {} };
  }

  /**
   * Get device information
   */
  function deviceInfo(callback) {
    request('luna://com.webos.service.tv.systemproperty', {
      method: 'getSystemInfo',
      parameters: { keys: ['modelName', 'firmwareVersion', 'UHD', 'sdkVersion'] },
      onSuccess: function(data) {
        callback({
          modelName: data.modelName || 'Unknown',
          version: data.firmwareVersion || data.sdkVersion || 'Unknown',
          uhd: data.UHD === 'true',
          sdkVersion: data.sdkVersion || 'Unknown'
        });
      },
      onFailure: function() {
        // Fallback
        callback({
          modelName: 'LG Smart TV',
          version: 'Unknown',
          uhd: false,
          sdkVersion: 'Unknown'
        });
      }
    });
  }

  /**
   * Fetch application info
   */
  function fetchAppInfo(callback) {
    request('luna://com.webos.applicationManager', {
      method: 'getForegroundAppInfo',
      parameters: {},
      onSuccess: callback,
      onFailure: callback
    });
  }

  /**
   * Launch an application
   */
  function launch(params) {
    return request('luna://com.webos.applicationManager', {
      method: 'launch',
      parameters: params.parameters || { id: params.id },
      onSuccess: params.onSuccess,
      onFailure: params.onFailure
    });
  }

  /**
   * webOS API object
   */
  var webOS = {
    platform: {
      tv: true
    },
    service: {
      request: request
    },
    deviceInfo: deviceInfo,
    fetchAppInfo: fetchAppInfo,
    launch: launch,
    libVersion: '1.2.0'
  };

  // Expose globally
  window.webOS = webOS;

  console.log('[webOSTV] webOS bridge initialized successfully');
  console.log('[webOSTV] PalmServiceBridge available:', !!PalmServiceBridge);

})(window);
