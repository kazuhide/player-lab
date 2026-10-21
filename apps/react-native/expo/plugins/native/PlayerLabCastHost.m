#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PlayerLabCastHost, NSObject)
RCT_EXTERN_METHOD(readOptions:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(saveOptions:(NSString *)applicationId namespace:(NSString *)messageNamespace resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
