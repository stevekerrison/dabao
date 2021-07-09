# Dabao - A network visualiser

Dabao is a network visualiser with the aim of showing step-by-step, layer-by-layer, how communication happens on the Internet. It is created with the intent to answer, in-depth, the question: "How does my computer download a web page?". However, it's designed in such a way that other scenarios can be played out too.

## The name

In Singapore, to "dabao" or "打包" means to take-away food. More directly, it means to bale/pack or unpack something. This software helps to pack/unpack the contents of messages at different layers of the network stack, so the name seems somewhat fitting.

## How to use

Right now, Dabao approximately simluates a simple HTTP request, including DNS lookup and some ARP exchanges. You can "step" through each "hop" of packets, or run the exchange continuously. You will see the packets traverse a network and the contents of the packets change along the way.

## Software utilised

- [`IP-Num`](https://github.com/ip-num/ip-num), a library for creating/manipulating IP addresses
- [`CytoscapeJS`](https://js.cytoscape.org/), a JavaScript version of the Cytoscape graph visualiser
  - [`Cytoscape-fcose`](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose), Fast Compound Spring Embedder for layout
  - [`Cytoscape-automove`](https://github.com/cytoscape/cytoscape.js-automove), for layout
- [`D3`](https://d3js.org/) for packet and node data presentation