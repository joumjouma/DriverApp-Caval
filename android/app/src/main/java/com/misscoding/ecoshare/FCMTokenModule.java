package com.misscoding.ecoshare;

import android.util.Log;
import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.messaging.FirebaseMessaging;

public class FCMTokenModule extends ReactContextBaseJavaModule {
    private static final String TAG = "FCMTokenModule";
    private final ReactApplicationContext reactContext;

    public FCMTokenModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    @NonNull
    public String getName() {
        return "FCMTokenModule";
    }

    @ReactMethod
    public void getFCMToken(Promise promise) {
        try {
            FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(new OnCompleteListener<String>() {
                    @Override
                    public void onComplete(@NonNull Task<String> task) {
                        if (!task.isSuccessful()) {
                            Log.w(TAG, "Fetching FCM registration token failed", task.getException());
                            promise.reject("FCM_TOKEN_ERROR", "Failed to get FCM token", task.getException());
                            return;
                        }

                        // Get new FCM registration token
                        String token = task.getResult();
                        Log.d(TAG, "FCM Token: " + token);
                        
                        // Send token to React Native
                        sendEvent("FCMTokenReceived", token);
                        
                        // Resolve promise with token
                        promise.resolve(token);
                    }
                });
        } catch (Exception e) {
            Log.e(TAG, "Error getting FCM token", e);
            promise.reject("FCM_TOKEN_ERROR", "Error getting FCM token", e);
        }
    }

    @ReactMethod
    public void onTokenRefresh() {
        FirebaseMessaging.getInstance().getToken()
            .addOnCompleteListener(new OnCompleteListener<String>() {
                @Override
                public void onComplete(@NonNull Task<String> task) {
                    if (!task.isSuccessful()) {
                        Log.w(TAG, "Fetching FCM registration token failed", task.getException());
                        return;
                    }

                    // Get new FCM registration token
                    String token = task.getResult();
                    Log.d(TAG, "FCM Token refreshed: " + token);
                    
                    // Send token to React Native
                    sendEvent("FCMTokenRefreshed", token);
                }
            });
    }

    private void sendEvent(String eventName, String token) {
        WritableMap params = Arguments.createMap();
        params.putString("token", token);
        
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
    }
} 