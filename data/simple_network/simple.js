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

class DabaoARP extends DabaoActivity {
    constructor ({
        cy,
        querier,
        responder,
        target,
        source
    } = {}) {
        super({cy: cy, initiator: querier, sender: querier, receiver: responder})
        this.target = target
        this.source = source
        this.querier = querier
        this.responder = responder

    }

    *trace() {
        if (this.cy.data('lod').has('arp')) {
            // Send the query
            // TODO: assign IPs to interface edges, not just nodes
            let tgtip = this.responder.data('_ips')[0].toString()
            let srcip = this.querier.data('_ips')[0].toString()
            let arp_cache = this.querier.data('_arpcache')
            if (!arp_cache) {
                arp_cache = new Set()
            }
            if (arp_cache.has(tgtip)) {
                // No need to ARP
                return
            }
            let result = {
                "_schema_type": "ethernet_l2",
                "_path": [this.querier, this.responder],
                "source_mac": this.source,
                "destination_mac": 'FF:FF:FF:FF:FF:FF',
                "_payload": {
                    "_schema_type": "arp",
                    "_description": `Who has ${tgtip}? Tell ${this.source}`
                }
            }
            console.log(result)
            yield result
            // Cache the result
            arp_cache.add(tgtip)
            this.querier.data('_arpcache', arp_cache)
            // Presume the responder will remember the sender too
            let r_arp_cache = this.responder.data('_arpcache')
            if (!r_arp_cache) {
                r_arp_cache = new Set()
            }
            r_arp_cache.add(srcip)
            this.responder.data('_arpcache', r_arp_cache)
            
            yield {
                "_schema_type": "ethernet_l2",
                "_path": [this.responder, this.querier],
                "source_mac": this.target,
                "destination_mac": this.source,
                "_payload": {
                    "_schema_type": "arp",
                    "_description": `{tgtip} is at {this.target}`
                }
            }
        }
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
            let path = this.cy.data('fw').path(this.sender, this.receiver)
            let nodes = path.nodes('[type != "network"]')
            let cur;
            for (node of nodes) {
                if (node == this.sender) {
                    cur = node
                    continue
                }
                let subpath = this.cy.data('fw').path(cur, node).edges()
                let srcmac, dstmac
                for (let edge of subpath) {
                    let d = edge.data('_MAC-' + cur.id())
                    if (d) srcmac = d
                    d = edge.data('_MAC-' + node.id())
                    if (d) dstmac = d
                }
                let arp = new DabaoARP({
                    cy: this.cy,
                    querier: cur,
                    responder: node,
                    target: dstmac,
                    source: srcmac
                })
                for (let packet of arp.trace()) {
                    yield packet
                }                
                let result = {
                    "_schema_type": "ethernet_l2",
                    "_path": [cur, node],
                    "source_mac": srcmac,
                    "destination_mac": dstmac,
                    "_payload": this.packet
                }
                console.log(result)
                yield result
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

class MAC {
    constructor(value) {
        this.value = value
    }

    toString() {
        let bytes = new Array()
        for (let byte = 5; byte >= 0; byte -= 1) {
            bytes.push(Number((this.value >> (byte * 8)) & 0xff).toString(16).toUpperCase().padStart(2, '0'))
        }
        return bytes.join(':')
    }
}

class MACRandomiser {
    constructor() {
        this.pool = new Set()
    }

    /**
     * Generate a random MAC.
     * 
     * Optionally fix portions of the MAC. Returned value is (R & ~mask) | fixed
     * where R is a random integer in range 0 to (2^48)-1.
     * 
     * Uniqueness is guaranteed.
     * 
     * @param {integer} fixed The value used for fixed bits
     * @param {integer} mask Bitmask
     * @returns {integer} The random MAC
     */
    generate({fixed = [], mask = []} = {}) {
        if (fixed.length != mask.length) {
            throw "Fixed value and mask arrays must be same length"
        }
        for (let attempts = 0; attempts < 5; attempts += 1) {
            let bytes = new Array()
            for (let byte = 0; byte < 6; byte += 1) {
                let val = getRandomInt(0, 256)
                if (fixed.length >= byte + 1) {
                    val &= ~mask[byte]
                    val |= fixed[byte]
                }
                bytes.push(Number(val).toString(16).toUpperCase().padStart(2, '0'))
            }
            let mac = bytes.join(':')
            if (!this.pool.has(mac)) {
                this.pool.add(mac)
                return mac
            }
        }
        throw "Failed to allocate random MAC. Pool may be getting full or fixed constraints may limit pool size"
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
    let macgen = new MACRandomiser()
    for (var node of cy.nodes('[type != "network"]')) {
        for (let edge of node.neighbourhood('edge')) {
            let mac = macgen.generate({
                fixed: [0xda, 0xba, 0x00, 0x00, 0x00, 0x00],
                mask: [0xff, 0xff, 0xf0, 0x00, 0x00, 0x00]
            })
        
            edge.data('_MAC-' + node.id(), mac)
        }
        console.log(node.id(), node.data('_ips').map(e => { return e.toString(); }));
    }
}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

class dabao_packet_animation {
    constructor(cy, packetid, trace, auto = true, pps = 0.5) {
        this.packetid = packetid;
        this.trace = trace
        this.auto = auto;
        this.packet = undefined
        this.remote = false
        this.itv = this.trace.next()
        this.cy = cy
        this.in_network = false
        this.pps = pps
    }

    animate() {
        var nextfunc = this.auto ? this.animate.bind(this) : undefined;
        if (this.remove) {
            console.log("Removing packet node")
            this.packet.remove()
            this.cy.elements(':selected').unselect()
            // Done!
            return;
        }
        if (!this.packet) {
            let segment = this.itv.value['_path']
            document.getElementById("next").disabled = this.auto
            let curpos = segment[0].position()
            console.log("Creating node and easing in");
            this.packet = this.cy.add({
                'group': 'nodes',
                'data': {'id': 'packet', 'label': 'Packet'},
                'position': {x: curpos.x + 20, y: curpos.y + 40},
                'complete': nextfunc
            });
            this.packet.animate({
                'duration': 500,
                'style': { 'opacity': 1.0 },
                'easing': 'ease-in',
                'complete': nextfunc
            });
            // Early out
            return
        }
        if (this.itv.done) {
            console.log("Ending animation and easing out")
            this.packet.animate({
                'duration': 500,
                'style': { 'opacity': 0 },
                'easing': 'ease-out',
                'complete': nextfunc
            })
            this.remove = true
            return
        }
        let curnode = this.itv.value['_path'][0];
        let nextnode = this.itv.value['_path'][1];
        let vizpath = this.cy.data('fw').path(curnode, nextnode)
        if (!this.in_network) {
            this.cy.elements(':selected').unselect()
            vizpath.select()
            if (this.itv.value.destination_mac == 'FF:FF:FF:FF:FF:FF') {
                vizpath.nodes('[type = "network"]').neighbourhood().select()
            }
        }
        switch (vizpath.nodes().size()) {
            case 2:
                // Nothing to do
                break
            case 3:
                if (this.in_network) {
                    curnode = vizpath.nodes()[1]
                    this.in_network = false
                } else {
                    nextnode = vizpath.nodes()[1]
                    this.in_network = true
                }
                break
            default:
                throw "Unexpected visualisation path length"
        }
        var nextpos = nextnode.position()
        var ease = 'linear';
        let curpos = curnode.position()
        let distance = Math.sqrt((curpos.x - nextpos.x) ** 2 + (curpos.y - nextpos.y) ** 2)
        let duration = distance / this.pps
        this.packet.animate({
            'duration': duration,
            'position': { x: nextpos.x + 20, y: nextpos.y + 40 },
            'easing': ease,
            'style': { 'opacity': 1.0 },
            'complete': nextfunc
        });
        if (!this.in_network) {
            this.itv = this.trace.next()
        }
        return;
    }
}
