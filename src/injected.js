// Code injected into the page

/* eslint-env browser, webextensions */
/* global io */

// security: be mindful about what data access the extension gives pages
// - regarding CORS, sites can already request any URL using a proxy like CORS Anywhere 
// - if the extension were to request resources with cookies it could expose private information
// - Privacy Issue! A site could see if another site had been visited
//   (if the extension was enabled on that site and the malicious site)
//   by measuring the upscaling response time to see if it was in the cache.
//   The difference between cache response time and the superresolution process is very significant,
//   so it would be very reliable.
//   TODO: to solve this, maybe keep a separate cache per origin - and separate spider, and jobs list and everything

(async ()=> {
	console.log("Rezzy content script injected.");

	const { find_next_prev_links } = globalThis;

	let rezzy_active = false;
	let options = {};

	function handle_keydown(event) {
		const starting_url = location.href;
		const starting_scroll_x = window.scrollX;
		// Also regarding pushState, it may have already happened in an earlier keydown handler (race condition)
		// could do an interval / animation loop to keep track of the active URL
		setTimeout(()=> {
			// if the page scrolled, do nothing
			// this might warrant a setting, or be more annoying than it's worth
			// possible race condition: scroll doesn't occur within this timeframe if the page is lagging
			// TODO: just check if scrollX is at the (relevant) limit instead?
			if (starting_scroll_x !== window.scrollX) {
				return;
			}
			// in case the site already handles arrow keys, and does history.pushState or uses location.hash
			// example site: https://www.avasdemon.com/pages.php#0001
			if (starting_url !== location.href) {
				return;
			}

			if (event.key === "ArrowRight") {
				find_next_prev_links().next?.click();
			}
			if (event.key === "ArrowLeft") {
				find_next_prev_links().prev?.click();
			}
		}, 100);
	}

	// #region gamepad support
	console.log("Rezzy: gamepad support enabled");

	const haveEvents = 'ongamepadconnected' in window;
	const controllers = {};
	const wasPressed = {};
	
	function connectHandler(e) {
		addGamepad(e.gamepad);
	}
	
	function addGamepad(gamepad) {
		controllers[gamepad.index] = gamepad;
	
		// const d = document.createElement("div");
		// d.setAttribute("id", `controller${gamepad.index}`);
	
		// const t = document.createElement("h1");
		// t.textContent = `gamepad: ${gamepad.id}`;
		// d.appendChild(t);
	
		// const b = document.createElement("div");
		// b.className = "buttons";
		gamepad.buttons.forEach((button, i) => {
			// const e = document.createElement("span");
			// e.className = "button";
			// e.textContent = i;
			// b.appendChild(e);
			// It's important to use the pressed state, not just false,
			// to avoid rapidly moving through pages (when they load fast.)
			wasPressed[i] = button.pressed;
		});
	
		// d.appendChild(b);
	
		// const a = document.createElement("div");
		// a.className = "axes";
	
		// gamepad.axes.forEach((axis, i) => {
		// 	const p = document.createElement("progress");
		// 	p.className = "axis";
		// 	p.setAttribute("max", "2");
		// 	p.setAttribute("value", "1");
		// 	p.textContent = i;
		// 	a.appendChild(p);
		// });
	
		// d.appendChild(a);
	
		// See https://github.com/luser/gamepadtest/blob/master/index.html
		// const start = document.getElementById("start");
		// if (start) {
		// 	start.style.display = "none";
		// }
	
		// document.body.appendChild(d);
		requestAnimationFrame(updateStatus);
	}
	
	function disconnectHandler(e) {
		removeGamepad(e.gamepad);
	}
	
	function removeGamepad(gamepad) {
		// const d = document.getElementById(`controller${gamepad.index}`);
		// document.body.removeChild(d);
		delete controllers[gamepad.index];
	}
	
	function updateStatus() {
		if (!haveEvents) {
			scanGamepads();
		}
	
		// for (const [i, controller] of Object.entries(controllers)) {
		for (const controller of Object.values(controllers)) {
			// const d = document.getElementById(`controller${i}`);
			// const buttons = d.getElementsByClassName("button");
	
			controller.buttons.forEach((button, i) => {
				// const b = buttons[i];
				let pressed = button === 1.0;
				let val = button;
	
				if (typeof button === "object") {
					pressed = val.pressed;
					val = val.value;
				}
	
				// const pct = `${Math.round(val * 100)}%`;
				// b.style.backgroundSize = `${pct} ${pct}`;
	
				if (pressed) {
					// b.className = "button pressed";
					if (!wasPressed[i] && rezzy_active) {
						// navigate to next/prev page with shoulder buttons
						if (i === 4) {
							console.log(`Rezzy: gamepad button ${i} pressed - navigating to prev page`, find_next_prev_links().prev);
							find_next_prev_links().prev?.click();
						} else if (i === 5) {
							console.log(`Rezzy: gamepad button ${i} pressed - navigating to next page`, find_next_prev_links().next);
							find_next_prev_links().next?.click();
						}
					}
				} else {
					// b.className = "button";
				}
				wasPressed[i] = pressed;
			});
	
			// const axes = d.getElementsByClassName("axis");
			controller.axes.forEach((axis, i) => {
				// const a = axes[i];
				// a.textContent = `${i}: ${axis.toFixed(4)}`;
				// a.setAttribute("value", axis + 1);

				// scroll the page
				const deadZone = 0.2;
				if (Math.abs(axis) > deadZone && rezzy_active) {
					const scroll_amount = Math.pow((Math.abs(axis) - deadZone) * 10, 2) * Math.sign(axis);
					if (i === 0) {
						window.scrollBy(scroll_amount, 0);
					} else {
						window.scrollBy(0, scroll_amount);
					}
				}
			});
		}
	
		requestAnimationFrame(updateStatus);
	}
	
	function scanGamepads() {
		const gamepads = navigator.getGamepads();
		for (const gamepad of gamepads) {
			if (gamepad) { // Can be null if disconnected during the session
				if (gamepad.index in controllers) {
					controllers[gamepad.index] = gamepad;
				} else {
					addGamepad(gamepad);
				}
			}
		}
	}
	
	window.addEventListener("gamepadconnected", connectHandler);
	window.addEventListener("gamepaddisconnected", disconnectHandler);
	
	if (!haveEvents) {
		setInterval(scanGamepads, 500);
	}
	// #endregion
	
	let socket;
	let jobs_by_url = {};

	function update_jobs_list() {
		collect_new_jobs();
		for (const job of Object.values(jobs_by_url)) {
			// job.elements.forEach(element=> {
			// 	element.style.outline = `${visible_pixels(element)/50000}px solid red`;
			// });
			job.priority = get_priority(job);
			// console.log("priority", job.priority, "for", job.elements);
		}
		const jobs =
			[...Object.values(jobs_by_url)]
			.map(({url, scaling_factor, priority})=> ({url, scaling_factor, priority}));
		socket.emit("jobs", jobs);
		socket.emit("spider", {
			starting_url: location.href,
			crawl_backward_pages: options.crawl_backward_pages,
			crawl_forward_pages: options.crawl_forward_pages
		});
	}

	function get_priority(job) {
		const pixels = job.elements.map(visible_pixels).reduce((a, b) => a + b, 0);
		let priority = pixels;
		// TODO: find good values for these priority modifiers
		if (!job.elements.every((element)=> element.tagName === "IMG")) {
			priority /= 10;
		}
		if (document.visibilityState !== "visible") {
			priority /= 2;
		}
		if (!document.hasFocus()) {
			priority /= 2;
		}
		return priority;
	}

	function visible_pixels(element) {
		if (!element.parentElement) return 0;
		if (element.offsetWidth === 0 || element.offsetHeight === 0) return 0;
		const style = getComputedStyle(element);
		if (style.display === "none" || style.visibility === "hidden") return 0;
		const bounds = element.getBoundingClientRect();
		const visibleWidth = Math.max(0, Math.min(window.innerWidth, bounds.right) - Math.max(0, bounds.left));
		const visibleHeight = Math.max(0, Math.min(window.innerHeight, bounds.bottom) - Math.max(0, bounds.top));
		return visibleWidth * visibleHeight;
	}

	function add_job({url, elements, apply_result_to_page}) {
		if (!url.match(/^https?:/)) {
			console.warn("Tried to add a job for a non-HTTP(S) URL:", url, elements);
			return;
		}
		// TODO: handle multiple elements with the same image resource
		// i.e. allow for multiple callbacks, not just one (apply_result_to_page)
		const job = jobs_by_url[url] || {
			url,
			scaling_factor: 2, // can't be changed for now
			elements: [], // added with concat below
			priority: 0, // calculated below
			apply_result_to_page,
		};
		jobs_by_url[url] = job;
		job.elements = job.elements.concat(elements);
		job.priority = get_priority(job);
	}

	function init_socket() {
		if (socket) {
			return;
		}
		socket = io("http://localhost:4284", {transports: ["websocket"]});

		socket.on("superrez-result", async ({url, scaling_factor, result_url})=> {
			const job = jobs_by_url[url];
			if (!job) return;
			// fetch result and make blob URL instead of using result URL directly
			// in order to avoid CORS issues
			try {
				const response = await fetch(result_url);
				const blob = await response.blob();
				const blob_url = URL.createObjectURL(blob);
				job.apply_result_to_page(blob_url, scaling_factor);
			} catch (error) {
				console.error("Failed to apply superrez result:", error, "url:", url, "result_url:", result_url);
			}
		});
	}

	function collect_new_jobs() {
		// console.log("collect jobs");

		const imgs = Array.from(document.getElementsByTagName("img"));
		const allElements = Array.from(document.querySelectorAll("*"));

		// TODO: what about pseudo elements (::before and ::after) (w/ background[-image]: or content:)?
		// Would have to parse and generate CSS to support that.

		// What about :hover and :active?
		// Hover effects that use CSS sprites work already! (e.g. next/prev buttons in Unsounded)
		// It wouldn't work with :hover { background-image: url(hover.png); } but that's not a good pattern

		imgs
			.filter((img)=> !img.superrezQueued)
			.forEach((img)=> {
				img.superrezQueued = true;
				add_job({
					url: img.src,
					elements: [img],
					apply_result_to_page: (superrez_url)=> {
						img.dataset.originalImgSrc = img.src;
						const computedStyle = getComputedStyle(img);
						// We may need to wait for the image to load.
						if (
							parseFloat(computedStyle.width) === 0 ||
							parseFloat(computedStyle.height) === 0
						) {
							img.addEventListener("load", ()=> {
								const computedStyle = getComputedStyle(img);
								img.style.width = computedStyle.width;
								img.style.height = computedStyle.height;
								img.src = superrez_url;
							}, {once: true});
						} else {
							img.style.width = computedStyle.width;
							img.style.height = computedStyle.height;
							img.src = superrez_url;
						}
					}
				});
			});
		// TODO: robust css background-image parsing
		const css_url_regex = /url\(["']?([^'"]*)["']?\)/;
		allElements
			.filter((el)=> !el.superrezQueued)
			.filter((el)=> getComputedStyle(el).backgroundImage.match(css_url_regex))
			.forEach((el)=> {
				el.superrezQueued = true;
				const {backgroundImage, backgroundSize} = getComputedStyle(el);
				const original_url = backgroundImage.match(css_url_regex)[1];
				add_job({
					url: original_url,
					elements: [el],
					apply_result_to_page: (superrez_url, scaling_factor)=> {
						// TODO: what about multiple backgrounds?

						// TODO: instead of parsing background-size,
						// try generating an SVG that just contains an <image>
						// at a higher resolution than the SVG's intrinsic size

						el.dataset.originalBackgroundImage = el.style.backgroundImage;

						const newBackgroundImage = backgroundImage.replace(css_url_regex, `url("${superrez_url}")`);

						if (backgroundSize === "contain" || backgroundSize === "cover") {
							el.style.backgroundImage = newBackgroundImage;
						} else if (!backgroundSize || backgroundSize === "auto") {
							const new_image = new Image();
							new_image.onload = ()=> {
								el.style.backgroundSize = `${new_image.width/scaling_factor}px ${new_image.height/scaling_factor}px`;
								el.style.backgroundImage = newBackgroundImage;
							};
							new_image.onerror = ()=> {
								console.error("couldn't superrez background-image for", el, "failed to load image URL", superrez_url, "to get width/height");
							};
							new_image.src = superrez_url;
						} else {
							// TODO: parse one and two value syntax
							// el.style.backgroundSize = rescale(backgroundSize);
							// el.style.backgroundImage = newBackgroundImage;
							console.error("can't handle background-size: ", backgroundSize);
						}
					},
				});
			});
	}

	let iid;

	const set_enabled = (enable)=> {
		if (enable === rezzy_active) {
			return;
		}
		clearInterval(iid);
		rezzy_active = enable;
		if (rezzy_active) {
			window.addEventListener("keydown", handle_keydown);
			init_socket();
			update_jobs_list();
			iid = setInterval(update_jobs_list, 500);
			socket.connect();
		} else {
			window.removeEventListener("keydown", handle_keydown);
			const imgs = document.querySelectorAll("[data-original-img-src]");
			for (const img of imgs) {
				img.src = img.dataset.originalImgSrc;
				delete img.dataset.originalImgSrc;
			}
			const elements = document.querySelectorAll("[data-original-background-image]");
			for (const element of elements) {
				element.style.backgroundImage = element.dataset.originalBackgroundImage;
				delete element.dataset.originalBackgroundImage;
			}
			socket.disconnect();
		}
	};

	browser.storage.onChanged.addListener((changes)=> {
		if (location.origin in changes) {
			set_enabled(!!changes[location.origin].newValue);
			if (rezzy_active) {
				console.log("Rezzy enabled for origin", location.origin);
			} else {
				console.log("Rezzy disabled for origin", location.origin);
			}
		}
		for (const [key, { newValue }] of Object.entries(changes)) {
			if (["crawl_forward_pages", "crawl_backward_pages"].includes(key)) {
				options[key] = newValue;
			}
		}
	});

	Object.assign(options, await browser.storage.local.get(["crawl_forward_pages", "crawl_backward_pages"]));

	const storedInfo = await browser.storage.local.get(location.origin);
	set_enabled(!!storedInfo[location.origin]);
	if (rezzy_active) {
		console.log("Rezzy active. Enabled for origin", location.origin);
	} else {
		console.log("Rezzy inactive. Not enabled for origin", location.origin);
	}
})();
