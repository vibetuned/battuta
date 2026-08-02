/**
 * Native Verovio runner benchmark.
 * Usage: bench <resourcePath> <optionsJson> <iterations> <file1> [file2 ...]
 * Prints one JSON line per file: {"file":..., "p50":..., "p95":..., "svgBytes":...}
 * Timings cover LoadData + RenderToSVG(1), same protocol as the WASM benches.
 */
#include "toolkit.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

static double quantile(std::vector<double> xs, double q)
{
    std::sort(xs.begin(), xs.end());
    size_t i = std::min(xs.size() - 1, (size_t)(q * xs.size()));
    return xs[i];
}

int main(int argc, char **argv)
{
    if (argc < 5) {
        fprintf(stderr, "usage: bench <resourcePath> <optionsJson> <iters> <files...>\n");
        return 2;
    }
    std::string resPath = argv[1];
    std::string options = argv[2];
    int iters = atoi(argv[3]);

    vrv::Toolkit toolkit(false);
    if (!toolkit.SetResourcePath(resPath)) {
        fprintf(stderr, "bad resource path: %s\n", resPath.c_str());
        return 2;
    }
    toolkit.SetOptions(options);

    for (int a = 4; a < argc; a++) {
        std::ifstream f(argv[a]);
        std::stringstream buf;
        buf << f.rdbuf();
        std::string data = buf.str();

        // warmup
        toolkit.LoadData(data);
        std::string svg = toolkit.RenderToSVG(1);

        std::vector<double> times;
        for (int i = 0; i < iters; i++) {
            auto t0 = std::chrono::steady_clock::now();
            toolkit.LoadData(data);
            svg = toolkit.RenderToSVG(1);
            auto t1 = std::chrono::steady_clock::now();
            times.push_back(std::chrono::duration<double, std::milli>(t1 - t0).count());
        }
        printf("{\"file\":\"%s\",\"p50\":%.2f,\"p95\":%.2f,\"svgBytes\":%zu}\n", argv[a], quantile(times, 0.5),
            quantile(times, 0.95), svg.size());
        fflush(stdout);
    }
    return 0;
}
