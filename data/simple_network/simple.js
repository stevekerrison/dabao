function simple() {
    return;
    // Network to use to generate IP addresses. It will still avoid existing networks
    const autogen_ipv4_pool = ["10.0.0.0/8"];
    // Mask bits set when generating a network (31 assumes all point-to-point and unique interfaces per edge)
    const autogen_ipv4_mask = 31;

    for (var edge of cy.edges()) {
        var source = edge.source();
        var target = edge.target();
        var match = false;
        var possible_matches = [];
        // Check if source node has an interface definition for its target
        if ('interfaces' in source) {
            // It may have, as it has interfaces defined. Let's check them by finding most specific match
            for (var interface of source.interfaces) {
                if (interface.targets.length === 0) {
                    // Empty target list implies catch-all
                } else {
                    for (var match_target of interface.targets) {
                        if (match_target === target.id) {
                            // Exact match is an instant win
                            match = interface;
                        }
                    }
                }
            }
        } else {
            // Definitely doesn't as it has no interfaces yet
        }
    }
}
