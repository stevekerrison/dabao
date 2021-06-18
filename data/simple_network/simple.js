class DabaoActivity {
    /**
     * 
     * @param initiator The cytocape node that is the initiator of the session/connection (or the sender if stateless)
     * @param sender The cytocape node source of the first packet that is emitted by this activity
     * @param receiver The cytocape node receiver of the first packet that is emitted by this activity
     */
    constructor ({cy, initiator, sender, receiver} = {}) {
        this.cy = cy
        this.initiator = initiator;
        this.sender = sender;
        this.receiver = receiver;
        this.subActivities = new Map();
    }

    *trace() {
        throw "No trace generator triggered by child class(es)"
        yield undefined
    }
}

/**
 * MAC (L2) packet generation.
 */
class DabaoMAC extends DabaoActivity {
    constructor ({
        cy,
        sender,
        receiver,
        packet
    } = {}) {
        super({cy: cy, initiator: sender, sender: sender, receiver: receiver})
        this.packet = packet
    }

    *trace() {
        if (!this.cy.data('lod').has('mac')) {
            yield this.packet;
        } else {
            /**
             * TODO
             * 
             * 1. Get a path
             * 2. Generate individual packet traces between L2 nodes
             * 3. Optionally do ARP checks
             */
            console.log("Generating path from", this.sender.id(), "to", this.receiver.id());
            var path = this.cy.data('fw').path(this.sender, this.receiver).nodes('[type != "network"]')
            let cur;
            for (node of path) {
                if (node == this.sender) {
                    console.log("Skipping self")
                    cur = node
                    continue
                }
                if (this.cy.data('lod').has('arp')) {
                    throw "ARP not implemented yet"
                }
                yield {
                    "_schema_type": "ethernet_l2",
                    "source_mac": cur.id(),
                    "destination_mac": node.id(),
                    "_payload": this.packet
                }
                cur = node
            }
        }
    }
}

class DabaoIP extends DabaoActivity {
    constructor ({
        cy,
        sender,
        receiver,
        /* TODO: More fields */
        packet
    } = {}) {
        super({cy: cy, initiator: sender, sender: sender, receiver: receiver})
        this.packet = packet
    }

    *trace() {
        if (!this.cy.data('lod').has('ip')) {
            yield this.packet
        } else {
            let src_ips = this.sender.data('_ips')
            let dst_ips = this.receiver.data('_ips')
            let mac = new DabaoMAC({
                cy: this.cy,
                sender: this.sender,
                receiver: this.receiver,
                packet: {
                    "_schema_type": "ip",
                    "version": {
                        "_schema_type": "Descriptive field",
                        "value": 4
                    },
                    "_payload": {
                        "_schema_type": "ipv4",
                        "source_ip_address": {
                            "_schema_type": "descriptive_field",
                            "value": src_ips[Math.floor(Math.random() * src_ips.length)].toString()
                        },
                        "destination_ip_address": {
                            "_schema_type": "descriptive_field",
                            "value": dst_ips[Math.floor(Math.random() * dst_ips.length)].toString()
                        },
                        "_payload": this.packet
                    }
                }
            })
            for (let packet of mac.trace()) {
                yield packet
            }
        }
    }
}

/**
 * Simulate a DNS query
 */
class DabaoDNS extends DabaoActivity {
    constructor ({
        cy,
        client,
        query,
        server = cy.getElementById('dns'),
        response
    } = {}) {
        super({cy: cy, initiator: client, sender: client, receiver: server});
        this.client = client
        this.server = server
        this.query = query
        this.response = response
    }

    /**
     * Provide an IP of the target based on any available route from client to target
     * 
     * This avoids having to actually configure DNS in a simulation, but will fall
     * apart in more complex networks.
     * 
     * If multiple valid IPs are available, one will be randomly chosen.
     */
    _ip_by_path() {
        let dns_path = this.cy.data('fw').path(this.client, this.response).filter('node[^private]')
        let ips = dns_path[dns_path.length-1].data('_ips')
        // TODO: Remove IPs that wouldn't be considered to be accessible on the traversed edge (interface)
        return ips[Math.floor(Math.random() * ips.length)].toString()
    }

    *trace() {
        if (this.cy.data('lod').has('dns')) {
            let sendQuery = new DabaoUDP({
                cy: this.cy,
                sender: this.sender,
                receiver: this.receiver,
                src_port: getRandomInt(49152, 65535),
                dst_port: 53,
                packet: {
                    "_schema_type": "application",
                    "_path":  [this.client, this.server],
                    "_payload": {
                        "_schema_type": "descriptive_field",
                        "name": "DNS query",
                        "description": `Request for IP of "${this.query}"`
                    }
                }
            })
            for (let packet of sendQuery.trace()) {
                yield packet;
            }
            let ip = this._ip_by_path();
            let recvResponse = new DabaoUDP({
                cy: this.cy,
                sender: this.server,
                receiver: this.client,
                src_port: sendQuery.dst_port,
                dst_port: sendQuery.src_port,
                packet: {
                    "_schema_type": "application",
                    "_path":  [this.server, this.client],
                    "_payload": {
                        "_schema_type": "descriptive_field",
                        "name": "DNS response",
                        "description": `Host "${this.query}" is at "${ip}"`
                    }
                }
            })
            for (let packet of recvResponse.trace()) {
                yield packet
            }
        }
    }
}

class DabaoTCPSession extends DabaoActivity {
    constructor({
        cy,
        client,
        server,
        src_port = getRandomInt(49152, 65535),
        dst_port
    } = {}) {
        super({cy: cy, initiator: client, sender: client, receiver: client})
        this.client = client
        this.server = server
        this.src_port = src_port
        this.dst_port = dst_port
    }

    *trace() {
        if (this.cy.data('lod').has('tcp')) {
            throw "TCP session setup now implemented yet"
            yield undefined
        }
    }
}

class DabaoUDP extends DabaoActivity {
    constructor({
        cy,
        sender,
        receiver,
        src_port,
        dst_port,
        packet
    } = {}) {
        super({cy: cy, initiator: sender, sender: sender, receiver: receiver})
        this.src_port = src_port
        this.dst_port = dst_port
        this.packet = packet
    }

    *trace() {      
        if (!this.cy.data('lod').has('udp')) {
            yield this.packet;
        } else {
            let ipPacket = new DabaoIP({
                cy: this.cy,
                sender: this.sender,
                receiver: this.receiver,
                packet: {
                    "_schema_type": "udp",
                    "_path": [this.sender, this.receiver],
                    "source_port": this.src_port,
                    "destination_port": this.dst_port,
                    "_payload": this.packet
                }
            })
            for (let packet of ipPacket.trace()) {
                yield packet
            }
        }
    }
}

class DabaoTCPPacket extends DabaoActivity {
    constructor ({
        cy,
        client,
        server,
        dir = 'send',
        src_port = this.getRandomInt(49152, 65535),
        dst_port,
        packet
    } = {}) {
        super({cy: cy, initiator: client, sender: client, receiver: server})
        this.client = client
        this.server = server
        this.dir = dir
        this.src_port = src_port
        this.dst_port = dst_port
        this.packet = packet
    }

    *trace() {
        let lod = this.cy.data('lod')
        if (lod.has('tcp')) {
            throw "TCP packets not implemented yet"
            yield undefined
        } else if (lod.has('tcp_simple')) {
            let ipPacket = new DabaoIP({
                cy: this.cy,
                sender: this.dir == 'send' ? this.sender : this.receiver,
                receiver: this.dir == 'send' ? this.receiver : this.sender,
                packet: {
                    "_schema_type": "tcp",
                    "_path": [this.sender, this.receiver],
                    "source_port": this.dir == 'send' ? this.src_port : this.dst_port,
                    "destination_port": this.dir == 'send' ? this.dst_port : this.src_port,
                    "_payload": this.packet
                }
            })
            for (let packet of ipPacket.trace()) {
                yield packet
            }
        } else {
            yield this.packet
        }
    }
}

/**
* Simulate an HTTP request
* 
* Assumes a route exists between client and server and that
* standard ports are used
*/
class DabaoHTTP extends DabaoActivity {
    /**
    * @param client The Cytoscape node that will originate the request
    * @param server The Cytoscape node that will provide the response
    * @param {string} host The hostname used to refer to the server, will be server's host-safe ID otherwise 
    */
    constructor ({cy, client, server, host = false} = {}) {
        super({cy: cy, initiator: client, sender: client, receiver: server});
        this.client = client;
        this.server = server;
        this.host = host || server.replace(/[^a-z0-9\-\.]+/gi, '-');
        this.request =
`HTTP/1.1 GET /
Host: ${this.host}

`
        this.response =
`HTTP/1.1 200 OK

<html>
    <body>
        <h1>Hello!</h1>
    </body>
</html>

`
        this.subActivities.set('dns', new DabaoDNS({
            cy: this.cy,
            client: client,
            query: this.host,
            response: this.server
        })).set('tcpsess', new DabaoTCPSession({cy: cy, client: client, server: server}))
    }

    *trace() {
        console.log("Tracing DNS")
        for (let packet of this.subActivities.get('dns').trace()) {
            yield packet;
        }
        console.log("Tracing session")
        for (let packet of this.subActivities.get('tcpsess').trace()) {
            yield packet;
        }
        console.log("Tracing HTTP")
        let sendRequest = new DabaoTCPPacket({
            cy: this.cy,
            client: this.client,
            server: this.server,
            src_port: getRandomInt(49152, 65535),
            dst_port: 80,
            dir: 'send',
            packet: {
                "_schema_type": "application",
                "_path":  [this.client, this.server],
                "_payload": {
                    "_schema_type": "descriptive_field",
                    "name": "HTTP v1.1 request",
                    "value": this.request,
                    "description": `A simple GET request for "${this.host}" being served by "${this.server.id()}"`
                }
            }
        })
        for (let packet of sendRequest.trace()) {
            yield packet;
        }
        let recvResponse = new DabaoTCPPacket({
            cy: this.cy,
            client: this.client,
            server: this.server,
            dir: 'recv',
            src_port: sendRequest.src_port,
            dst_port: sendRequest.dst_port,
            packet: {
                "_schema_type": "application",
                "_path":  [this.server, this.client],
                "_payload": {
                    "_schema_type": "descriptive_field",
                    "name": "HTTP v1.1 response (200 OK)",
                    "value": this.response,
                    "description": `A successful response, containing a simple HTML document`
                }
            }
        })
        for (let packet of recvResponse.trace()) {
            yield packet
        }
    }
}


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
 * @param server The Cytoscape node that will provide the response
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