find_package(Threads REQUIRED)

# Since we have problems to integrate the source build. 
# We're using pre-installed versions instead. 
# ref: https://arrow.apache.org/install/
# Mac
# 1. install miniconda according to https://docs.conda.io/en/latest/miniconda.html
# 2. install arrow through "conda install arrow-cpp=0.13.* -c conda-forge"
# Ubuntu

# https://cmake.org/cmake/help/latest/module/ExternalProject.html
include(ExternalProject)

# build arrow
SET(ARROW_OPTS
  -DARROW_USE_CCACHE:BOOL=ON
  -DARROW_OPTIONAL_INSTALL:BOOL=OFF
  -DARROW_BUILD_TESTS:BOOL=OFF
  -DARROW_BUILD_BENCHMARKS:BOOL=OFF
  -DPARQUET_BUILD_EXAMPLES:BOOL=OFF
  -DARROW_ORC:BOOL=OFF
  -DARROW_NO_DEPRECATED_API:BOOL=ON
  -DARROW_JEMALLOC:BOOL=OFF
  -DARROW_IPC=OFF 
  -DARROW_COMPUTE=OFF 
  -DARROW_HDFS=OFF 
  -DARROW_WITH_BROTLI=OFF 
  -DARROW_WITH_LZ4=OFF 
  -DPARQUET_BUILD_ENCRYPTION=OFF
  -DCMAKE_BUILD_TYPE=Release
  -DOPENSSL_ROOT_DIR=${OPENSSL_ROOT})

ExternalProject_Add(arrow
  PREFIX arrow
  GIT_REPOSITORY https://github.com/apache/arrow.git
  GIT_TAG apache-arrow-0.13.0
  SOURCE_SUBDIR cpp
  CMAKE_ARGS ${ARROW_OPTS}
  UPDATE_COMMAND ""
  INSTALL_COMMAND ""
  LOG_DOWNLOAD ON
  LOG_CONFIGURE ON
  LOG_BUILD ON)

# get source dir after download step
ExternalProject_Get_Property(arrow SOURCE_DIR)
ExternalProject_Get_Property(arrow BINARY_DIR)
set(ARROW_INCLUDE_DIRS ${SOURCE_DIR}/cpp/src/)
file(MAKE_DIRECTORY ${ARROW_INCLUDE_DIRS})
set(ARROW_LIBRARY_PATH ${BINARY_DIR}/release/${CMAKE_FIND_LIBRARY_PREFIXES}arrow.a)
set(ARROW_LIBRARY libarrow)
add_library(${ARROW_LIBRARY} UNKNOWN IMPORTED)
set_target_properties(${ARROW_LIBRARY} PROPERTIES
    "IMPORTED_LOCATION" "${ARROW_LIBRARY_PATH}"
    "IMPORTED_LINK_INTERFACE_LIBRARIES" "${CMAKE_THREAD_LIBS_INIT}"
    "INTERFACE_INCLUDE_DIRECTORIES" "${ARROW_INCLUDE_DIRS}")
add_dependencies(${ARROW_LIBRARY} arrow)