// Configuracion raiz del proyecto Gradle de la aplicacion Android.
//
// Este modulo vive dentro del monorepo "Marathon Escudo Vivo" pero NO forma
// parte del espacio de trabajo de npm: se abre de forma independiente en
// Android Studio apuntando a esta carpeta (apps/nfc-android).

pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "marathon-nfc-studio"
include(":app")
