# Reglas de ofuscacion / reduccion para compilaciones de release.

# --- kotlinx.serialization -------------------------------------------------
# Los serializadores se generan como clases companion y objetos sinteticos.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class ec.marathon.nfcstudio.**$$serializer { *; }
-keepclassmembers class ec.marathon.nfcstudio.** {
    *** Companion;
}
-keepclasseswithmembers class ec.marathon.nfcstudio.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# --- Retrofit / OkHttp -----------------------------------------------------
-keepattributes Signature, Exceptions, RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keep,allowobfuscation interface ec.marathon.nfcstudio.data.api.ApiProduccion
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# --- SEGURIDAD -------------------------------------------------------------
# Se eliminan las llamadas a android.util.Log en release. El redactor de
# ec.marathon.nfcstudio.core.Registro ya filtra secretos, pero esta regla es la
# segunda barrera: en una compilacion firmada no queda ni una linea de log.
-assumenosideeffects class android.util.Log {
    public static *** v(...);
    public static *** d(...);
    public static *** i(...);
}

# androidx.security usa Tink por reflexion.
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**
