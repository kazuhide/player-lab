#if DEBUG
#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>

@interface PlayerLabRuntimeUiObserver : NSObject
+ (void)install;
@end

__attribute__((constructor)) static void installPlayerLabRuntimeUiObserver(void) {
    dispatch_async(dispatch_get_main_queue(), ^{ [PlayerLabRuntimeUiObserver install]; });
}
#endif
