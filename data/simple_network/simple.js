function simple(cy) {
    // Network to use to generate IP addresses. It will still avoid existing networks
    var peers = ipnum.IPv4CidrRange.fromCidr("10.11.12.0/31");
    var networks = ipnum.IPv4CidrRange.fromCidr("10.200.0.0/24");
    /* First assign subnets to networks without a network assigned to them */
    for (var node of cy.nodes('[type = "network"]')) {
        let subnet = node.data('subnet');
        if (!!subnet) {
            node.data('subnet', ipnum.IPv4CidrRange.fromCidr(subnet));
        } else {
            node.data('subnet', networks);
            networks = networks.nextRange();
        }
        node.data('next_ip', node.data('subnet').ipv4.nextIPNumber());
    }
    /* Now assign IPs to nodes based on the networks they are members of */
    for (var node of cy.nodes('[network]')) {
        let network = cy.getElementById(node.data('network'));
        ips = node.data('ips');
        if (!node.data('_ips')) {
            node.data('_ips', new Array());
        }
        var added = false;
        if (!!ips) {
            /* Try to add any specified IP to the _ips list */
            for (var ip of ips) {
                var cidr = new ipnum.IPv4CidrRange(new ipnum.IPv4(ip), new ipnum.IPv4Prefix(32));
                if (network.data('subnet').contains(cidr)) {
                    node.data('_ips').push(cidr.ipv4);
                    added = true;
                }
            }
        }
        /* If no IPs were added for this network, or no IPs were specified anyway, then grab one from the "pool" */
        if (!added) {
            var ip = network.data('next_ip');
            node.data('_ips').push(ip);
            network.data('next_ip', ip.nextIPNumber());
        }
        console.log(node.id(), node.data('_ips').map(e => { return e.toString(); }));
    }
    /* For peering connections, grab use the peer IP pool */
    for (var edge of cy.edges('[^network]')) {
        edge.data('subnet', peers);
        var next_ip = peers.ipv4.nextIPNumber();
        peers = peers.nextRange();
        var source = edge.source();
        if (!source.data('_ips')) {
            source.data('_ips', new Array());
        }
        source.data('_ips').push(next_ip);
        next_ip = next_ip.nextIPNumber();
        var target = edge.target();
        if (!target.data('_ips')) {
            target.data('_ips', new Array());
        }
        target.data('_ips').push(next_ip);
        console.log(
            edge.id(),
            edge.data('subnet').toCidrString(),
            source.data('_ips').map(e => { return e.toString(); }),
            target.data('_ips').map(e => { return e.toString(); })
        );
    }
    for (var node of cy.nodes('[type != "network"]')) {
        console.log(node.id(), node.data('_ips').map(e => { return e.toString(); }));
    }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
  }

/**
 * Simulate an HTTP request
 * 
 * Assumes a route can exist between client and server and that
 * the specified ports would work.
 * 
 * @param client The Cytoscape node that will originate the request
 * @param server The Cytoccape node that will provide the response
 * @param request Content of the request (not checked for correctness)
 * @param response Content of the response (not checked for correctness)
 * @returns A trace of packets that represent this request. Lower-level simulators may be able to expand this trace.
 */
var simulate_http = function(client, server, request, response) {
    /* Loosely parse the HTTP request and get the headers out, mainly to find the host */
    var headers = new Map();
    for (var line of request.split('\n\n')[0].split('\n').slice(1)) {
        var separator = line.indexOf(': ');
        var field = line.slice(0, separator);
        var value = line.slice(separator+2);
        headers.set(field.toLowerCase(), value);
    }
    trace = {
        "assumptions": [
            /* We assume that DNS would normally be performed to resolve the server's IP from the given host */
            {'dns': headers.get('host')},
            /* We use TCP to carry HTTP/1.1 traffic */
            {'tcp': {'destination': 80}},
            /* We use IP, ARP, etc to make the above work, but they can be simulated by other layers */
        ],
        "entries": [
            {
                "path": [client.id(), server.id()],
                "packet": {
                    "_schema_type": "application",
                    "_raw": request.split('').map((c) => { return c.charCodeAt(0); }),
                    "_payload": {
                        "_schema_type": "descriptive_field",
                        "name": "HTTP v1.1 request",
                        "value": request,
                        "description": `A request being sent to whoever is the registered host of "${headers.get('host')}"`
                    }
                }
            },
            {
                "path": [client.id(), server.id()],
                "packet": {
                    "_schema_type": "application",
                    "_raw": request.split('').map((c) => { return c.charCodeAt(0); }),
                    "_payload": {
                        "_schema_type": "descriptive_field",
                        "name": "HTTP v1.1 response (200 OK)",
                        "value": response,
                        "description": `A successful response, containing a simple HTML document`
                    }
                }
            }
        ]
    }
    return trace;
};

class dabao_packet_animation {
    constructor(packetid, path, auto = true) {
        this.packetid = packetid;
        this.path = path;
        this.position = 0;
        this.auto = auto;
    }

    animate() {
        var nextfunc = this.auto ? this.animate.bind(this) : undefined;
        if (this.position == 0) {
            document.getElementById("next").disabled = this.auto;
            var cy = window.cy;
            var curpos = this.path[this.position].position();
            this.packet = cy.add({
                'group': 'nodes',
                'data': {'id': 'packet', 'label': 'Packet'},
                'position': {x: curpos.x + 20, y: curpos.y + 40},
                'complete': nextfunc
            });
            this.position += 1;
            this.packet.animate({
                'duration': 500,
                'style': { 'opacity': 1.0 },
                'easing': 'ease-in',
                'complete': nextfunc
            });
        } else if (this.position == this.path.size()) {
            this.position += 1;
            this.packet.animate({
                'duration': 500,
                'style': { 'opacity': 0 },
                'easing': 'ease-out',
                'complete': nextfunc
            });
        } else if (this.position > this.path.size()) {
            this.packet.remove();
        } else {
            var curnode = this.path[this.position-1];
            var nextnode = this.path[this.position];
            var nextpos = nextnode.position();
            var ease = 'linear';
            if (this.position == 0) {
                ease = 'ease-in-sine';
            } else if (this.position == this.path.size() - 1) {
                ease = 'ease-out-sine';
            }
            this.position += 1;
            // TODO: animate selection properly
            curnode.edgesTo(nextnode).select();
            curnode.select();
            nextnode.select();
            this.packet.animate({
                'duration': 500,
                'position': { x: nextpos.x + 20, y: nextpos.y + 40 },
                'easing': ease,
                'style': { 'opacity': 1.0 },
                'complete': nextfunc
            });
            // TODO: Animate selection properly
            curnode.unselect();
            curnode.edgesTo(nextnode).unselect();
        }
        return;
    }
}

var trace = {
    "entries": [
        {"$comment": "We define a single-packet HTTP request/response here, then use some simple simulation to expand out the trace"},
        {
            "path": ["client", "web"],
            "packet": {
                "_schema_type": "ip",
                "version": {
                    "_schema_type": "descriptive_field",
                    "value": 4
                },
                "_payload": {
                    "_schema_type": "ipv4",
                    "source_ip_address": {
                        "_schema_type": "descriptive_field",
                        "value": "10.100.0.100"
                    },
                    "destination_ip_address": {
                        "_schema_type": "descriptive_field",
                        "value": "192.168.111.20"
                    },
                    "protocol": {
                        "_schema_type": "descriptive_field",
                        "value": "TCP"
                    },
                    "_payload": {
                        "_schema_type": "TCP",
                        "destination_port": {
                            "_schema_type": "descriptive_field",
                            "value": 80
                        },
                        "_payload": {
                            "_schema_type": "descriptive_field",
                            "value": "GET / HTTP/1.1\nHost: example.org\n\n"
                        }
                    }
                }
            }
        }
    ]
};