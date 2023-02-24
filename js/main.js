// load canvas
let canvas = document.getElementById('canvas');
// set up webgl context
let gl = canvas.getContext('webgl');
// set up shader program
let program = gl.createProgram();
// load vertex shader
let vertexShader = gl.createShader(gl.VERTEX_SHADER);
gl.shaderSource(vertexShader, `
    attribute vec2 position;
    void main() {
        gl_Position = vec4(position, 0, 1);
    }
`);
gl.compileShader(vertexShader);
let fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
gl.shaderSource(fragmentShader, `
    precision highp float;
    uniform float time;
    uniform float slide;
    uniform vec2 resolution;

    float sdSphere( vec3 p, float s )
    {
       return length(p)-s;
    }

    float sdTorus( vec3 p, vec2 t )
    {
        vec2 q = vec2(length(p.xz)-t.x,p.y);
        return length(q)-t.y;
    }

    // https://www.shadertoy.com/view/7tyGWw
    float sdDashedCircle( in vec2 p )
    {
        float arcRadius = length(p);

        const float RadiusOuter = 0.44;
        const float RadiusInner = 0.36;
        const float NumDashes = 30.;
        const float DashRatio = 0.5;  // set between 0-1 to adjust the empty space between dashs

        // Compute the radial distance field coming out from the center of a torus
        const float hw = (RadiusOuter-RadiusInner)*0.5; // half width from center of torus to edge
        float radialDF = arcRadius - (RadiusOuter-hw);  // creates a torus
        radialDF = abs(radialDF)-hw; // give an inside and outside to the torus


        // Compute the gradient along the length of the arc
        float arcGradient = atan(p.y,p.x)/6.283185;
        arcGradient = fract(arcGradient*NumDashes);
        arcGradient = abs((arcGradient-0.5)*2.0);  // make the gradient a linear, continous 0-1-0-1 repeating pattern
        arcGradient = arcGradient-DashRatio; // split the arc into positive and negative sections
        float Theta = arcGradient * (3.1415927/NumDashes); // gets us a signed angle from the nearest dash edge, in radians

        // figure out the point closest to us on the nearest dash edge
        float s = sin(Theta);
        float c = cos(Theta);
        float edgeProjection = clamp(c*arcRadius,RadiusInner,RadiusOuter); // project point p but bound it between the innner and outer radii of the dash
        vec2  nearestEdgeP = mat2(c,-s,s,c)*p * edgeProjection/arcRadius;
        float edgeDF = length(p-nearestEdgeP);

        return (Theta   >0.0) ? edgeDF   :
               (radialDF>0.0) ? radialDF :
                                max(-edgeDF,radialDF);
    }

    float sdTorusDashed( vec3 p )
    {
        p = vec3(p.y, p.z, p.x);
        float h = 0.01;
        float d = sdDashedCircle(p.xy);
        vec2 w = vec2( d, abs(p.z) - h );
        return min(max(w.x,w.y),0.0) + length(max(w,0.0));
    }

    float sdOctahedron( vec3 p, float s)
    {
        p = abs(p);
        float m = p.x+p.y+p.z-s;
        vec3 q;
             if( 3.0*p.x < m ) q = p.xyz;
        else if( 3.0*p.y < m ) q = p.yzx;
        else if( 3.0*p.z < m ) q = p.zxy;
        else return m*0.57735027;

        float k = clamp(0.5*(q.z-q.y+s),0.0,s);
        return length(vec3(q.x,q.y-s+k,q.z-k));
    }

    float opSmoothUnion( float d1, float d2, float k ) {
        float h = clamp( 0.5 + 0.5*(d2-d1)/k, 0.0, 1.0 );
        return mix( d2, d1, h ) - k*h*(1.0-h);
    }

    vec2 opU( vec2 d1, vec2 d2 )
    {
        return (d1.x<d2.x) ? d1 : d2;
    }

    vec3 round( in vec3 p ) {
        return floor(p+0.5);
    }

    float sdBox( vec3 p, vec3 b )
    {
        vec3 q = abs(p) - b;
        return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
    }

    float opRepLimBox( in vec3 p, in float c, in vec3 l, in vec3 box )
    {
        vec3 q = p-c*clamp(round(p/c),-l,l);
        return sdBox( q, box );
    }

    float sdOchedronWithTorus( vec3 pos, float s, float fade ) {
      float r = (sin(time) + 1.0) / 2.0;
      return opSmoothUnion(
        sdOctahedron(pos, 0.4 * r * fade),
        sdTorus(pos, vec2(0.4, 0.1) * (1.0 - r) * fade),
        0.3
      );
    }

    float sdPlate( vec3 pos, float ir, float r ) {
      float rect = sdBox(pos, vec3(0.01, r, r));
      float sphere = sdSphere(pos, r);
      float iSphere = sdSphere(pos, ir);
      return max(-iSphere, max(rect, sphere));
    }

    float sdPrezi( vec3 pos, float slide, float fade ) {
      float t1 =         sdTorus(pos.yxz, vec2(0.28, 0.01));
      float t2 = min(t1, sdTorus(pos.yxz, vec2(0.31, 0.01)));
      float t3 = min(t2, sdTorus(pos.yxz, vec2(0.34, 0.01)));

      // float t1 =         sdPlate(pos.xyz, 0.27, 0.29);
      // float t2 = min(t1, sdPlate(pos.xyz, 0.30, 0.32));
      // float t3 = min(t2, sdPlate(pos.xyz, 0.33, 0.35));

      // one standing rectangle
      float oneLine = sdBox(pos, vec3(0.01, 0.3, 0.01));
      // multiple rectangles next to each other
      vec3 l = vec3(0.0, 0.0, 3.0);
      float c = 0.08;
      vec3 boxQ = pos-c*clamp(round(pos/c),-l,l);
      float lines = sdBox(boxQ, vec3(0.01, 0.3, 0.02));
      float linesBound = sdSphere(pos, 0.25);
      float inside = max(lines, linesBound);
      // b = opRepLimBox(pos, 0.1, vec3(0.0, 0.0, 2.0), vec3(0.01, 0.3, 0.01));
      float t3OneLine = min(t3, oneLine);
      float t3Lines = min(t3, lines);
      float t3LinesBound = min(t3Lines, linesBound);
      float t3Inside = min(t3, inside);

      // float plate = sdPlate(pos, 0.4, 0.5);
      // move position to the top of the plate

      // failed attempt to make the plate move with the torus
      // vec3 qPlate = pos - vec3(0.0, 0.39, 0.0);
      // vec3 plateBox = vec3(0.01, 0.03, 0.01);
      // // repeat the plate around the torus, with a slight offset, rotating the plates to face them to the center
      // vec3 lPlate = vec3(0.0, 0.0, 3.0);
      // float cPlate = 0.08;
      // vec3 boxQPlate = qPlate-cPlate*clamp(round(qPlate/cPlate),-lPlate,lPlate);
      // float plate = sdBox(boxQPlate, plateBox);

      float plate = sdTorusDashed(pos);
      float prezi = min(t3Inside, plate);

      if (slide >= 18.0) {
        return prezi;
      }
      if (slide >= 17.0) {
        // return prezi;
        return mix(t3Inside, prezi, fade);
      }
      if (slide >= 16.0) {
        // return t3Inside;
        return mix(t3LinesBound, t3Inside, fade);
      }
      if (slide >= 15.0) {
        // return t3LinesBound;
        return mix(t3Lines, t3LinesBound, fade);
      }
      if (slide >= 14.0) {
        return mix(t3OneLine, t3Lines, fade);
      }
      if (slide >= 13.0) {
        return mix(t3, t3OneLine, fade);
      }
      if (slide >= 12.0) {
        return mix(t2, t3, fade);
      }
      if (slide >= 11.0) {
        return mix(t1, t2, fade);
      }
      return sdTorus(pos.yxz, vec2(0.28 * fade, 0.01)); // t1 with fade
    }

    float map( in vec3 pos )
    {
        float fade = fract(slide);
        if (slide > 10.0) {
            return sdPrezi(pos, slide, fade);
        }
        if (slide >= 10.0) {
            return 10.0;
        }
        if (slide >= 9.0) {
            return opRepLimBox(pos,2.0,vec3(100.0 * (1.0 - fade)), vec3(0.2));
        }
        if (slide >= 8.0) {
            return opRepLimBox(pos,2.0,vec3(2.0 + 98.0 * fade), vec3(0.2));
        }
        if (slide >= 7.0) {
            return opRepLimBox(pos,2.0,vec3(1.0 + fade), vec3(0.2));
        }
        if (slide >= 6.0) {
            // return sdBox(pos, vec3(0.2));
            return opRepLimBox(pos,2.0,vec3(fade), vec3(0.2));
        }
        if (slide >= 5.0) {
            return mix(
                sdOchedronWithTorus(pos, 0.4, 1.0),
                sdBox(pos, vec3(fade * 0.2)),
                fade
            );
        }
        if (slide >= 4.0) {
            return mix(
                sdTorus(pos, vec2(0.4, 0.1)),
                sdOchedronWithTorus(pos, 0.4, fade),
                fade
            );
        }
        if (slide >= 3.0) {
            return mix(
                sdOctahedron(pos, 0.4),
                sdTorus(pos, vec2(0.4, 0.1) * fade),
                fade
            );
        }
        if (slide >= 2.0) {
            return mix(
                sdSphere(pos, 0.4),
                sdOctahedron(pos, 0.4 * fade),
                fade
            );
        }
        if (slide >= 1.0) {
            return sdSphere(pos, 0.4 * fade);
        }
        return 10.0; // always outside
    }

    // https://iquilezles.org/articles/normalsSDF
    vec3 calcNormal( in vec3 pos )
    {
        vec2 e = vec2(1.0,-1.0)*0.5773;
        const float eps = 0.0005;
        return normalize( e.xyy*map( pos + e.xyy*eps ) +
                e.yyx*map( pos + e.yyx*eps ) +
                e.yxy*map( pos + e.yxy*eps ) +
                e.xxx*map( pos + e.xxx*eps ) );
    }

    void main() {
        // calculate gl_FragColor using gl_FragCoord and time
        vec3 rainbow = vec3(
            0.5 + 0.5 * cos(time + gl_FragCoord.x / 500.0),
            0.5 + 0.5 * sin(time + gl_FragCoord.y / 500.0),
            0.5 + 0.5 * sin(time + gl_FragCoord.x / 500.0 + gl_FragCoord.y / 500.0)
        );

        // camera movement
        float an = 0.5*(time-10.0);
        vec3 ro = vec3( 1.0*cos(an), 0.4, 1.0*sin(an) );
        vec3 ta = vec3( 0.0, 0.0, 0.0 );
        // camera matrix
        vec3 ww = normalize( ta - ro );
        vec3 uu = normalize( cross(ww,vec3(0.0,1.0,0.0) ) );
        vec3 vv = normalize( cross(uu,ww));

        vec3 tot = vec3(0.0);

        vec2 p = (-resolution.xy + 2.0*gl_FragCoord.xy)/resolution.y;

        // create view ray
        vec3 rd = normalize( p.x*uu + p.y*vv + 1.5*ww );

        // raymarch
        const float tmax = 300.0;
        float t = 0.0;
        for( int i=0; i<256; i++ )
        {
            vec3 pos = ro + t*rd;
            float h = map(pos);
            if( h<0.0001 || t>tmax ) break;
            t += h;
        }

        // shading/lighting
        // vec3 col = rainbow.zxy;
        vec3 col = vec3(0.8, 0.9, 1.0);
        if( t<tmax )
        {
            vec3 pos = ro + t*rd;
            vec3 nor = calcNormal(pos);
            vec3 dif_color = rainbow; // vec3(0.0,1.0,0.0);
            float dif = clamp( dot(nor,vec3(0.57703)), 0.0, 1.0 );
            float amb = 0.5 + 0.5*dot(nor,vec3(0.0,1.0,0.0));
            col = vec3(0.2,0.3,0.4)*amb + dif_color*dif;
            // col = mix(rainbow, col, abs(sin(time / 1.)));
        }

        // gamma
        // col = sqrt( col );
        tot += col;

        if (slide <= 2.0) {
            tot = mix(rainbow, tot, abs(slide - 1.0));
        }

        gl_FragColor = vec4( tot, 1.0 );
    }
`);
gl.compileShader(fragmentShader);
// attach shaders to program
gl.attachShader(program, vertexShader);
gl.attachShader(program, fragmentShader);
// link program
gl.linkProgram(program);
// use program
gl.useProgram(program);
// handle errors
if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
  console.error('ERROR compiling vertex shader!', gl.getShaderInfoLog(vertexShader));
}
if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
  console.error('ERROR compiling fragment shader!', gl.getShaderInfoLog(fragmentShader));
}
// set up vertex buffer
let vertexBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
// draw a rectangle
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
  -1, -1,
  1, -1,
  1, 1,
  -1, -1,
  1, 1,
  -1, 1
]), gl.STATIC_DRAW);
// set up position attribute
let positionAttribute = gl.getAttribLocation(program, 'position');
gl.enableVertexAttribArray(positionAttribute);
gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);

// set up time attribute
const timeAttribute = gl.getUniformLocation(program, 'time');
const slideAttribute = gl.getUniformLocation(program, 'slide');
const resolutionLocation = gl.getUniformLocation(program, "resolution");

// resize canvas to fill browser window dynamically
window.addEventListener('resize', resizeCanvas, false);

function resizeCanvas() {
  canvas.width = window.innerWidth / 2;
  canvas.height = window.innerHeight / 2;
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  let density = 1;
  gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
  gl.viewport(0, 0, canvas.width / density, canvas.height / density);
}

resizeCanvas();

// State

let time = 0.0;
let webGlIsOn = false;
let activeSlide = 1;
let slideChangedAt = 0.0;
let slideChangeDirection = 1;
const slideCount = document.getElementsByClassName('slide').length;
const glslideCount = document.getElementsByClassName('glslide').length;

// WebGL main loop

function loop() {
  time += 0.01;
  gl.uniform1f(timeAttribute, time);
  let s = (slideChangeDirection > 0 ?
    activeSlide + Math.min(1.0, (time - slideChangedAt) / 2.0) :
    activeSlide + 2.0 - Math.min(1.0, (time - slideChangedAt) / 2.0)) - slideCount - 1;
  console.log(s)
  gl.uniform1f(slideAttribute, s);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  if (webGlIsOn) {
    requestAnimationFrame(loop);
  }
}

// Presentation

function hide(slideNumber) {
  let slide = document.getElementById('slide-' + slideNumber);
  if (slide) {
    slide.style.visibility = 'hidden';
    slide.style.opacity = '0';
    let video = document.getElementById('slide-' + slideNumber).getElementsByTagName('video');
    if (video.length > 0) {
      video[0].pause();
    }
  }
}

function show(slideNumber) {
  let slide = document.getElementById('slide-' + slideNumber);
  if (slide) {
    slide.style.visibility = 'visible';
    slide.style.opacity = '1';
    let video = document.getElementById('slide-' + slideNumber).getElementsByTagName('video');
    if (video.length > 0) {
      video[0].play();
    }
  }
}

function showWebGL() {
  document.getElementById('canvas').style.display = 'block';
  webGlIsOn = true;
  loop();
}

function hideWebGL() {
  webGlIsOn = false;
  document.getElementById('canvas').style.display = 'none';
}

function webglSlideChange(direction) {
  let timeLeftFromSlideChange = Math.max(0.0, 2.0 - (time - slideChangedAt));
  if (direction < 0) {
    activeSlide--;
    slideChangedAt = time - timeLeftFromSlideChange;
    slideChangeDirection = -1;
  } else {
    activeSlide++;
    slideChangedAt = time - timeLeftFromSlideChange;
    slideChangeDirection = 1;
  }
}

function leftArrowPressed() {
  if (activeSlide === slideCount + 1) {
    hideWebGL();
    hide(activeSlide);
    webglSlideChange(-1);
    show(activeSlide);
  } else if (activeSlide > slideCount + 1) {
    hide(activeSlide);
    webglSlideChange(-1);
    show(activeSlide);
  } else if (activeSlide > 1) {
    hide(activeSlide);
    webglSlideChange(-1);
    show(activeSlide);
  }
}

function rightArrowPressed() {
  if (activeSlide > slideCount + glslideCount) {
    return;
  }
  if (activeSlide === slideCount) {
    hide(activeSlide);
    webglSlideChange(1);
    showWebGL();
    show(activeSlide);
  } else if (activeSlide > slideCount) {
    hide(activeSlide);
    webglSlideChange(1);
    show(activeSlide);
  } else if (activeSlide < slideCount) {
    hide(activeSlide);
    webglSlideChange(1);
    show(activeSlide);
  }
}

document.addEventListener('keydown', function (event) {
  if (event.key === 'ArrowLeft') {
    leftArrowPressed();
  } else if (event.key === 'ArrowRight') {
    rightArrowPressed();
  }
});

// call rightArrowPressed() when user swipes right
document.addEventListener('swiped-right', function (e) {
  rightArrowPressed();
});
// call leftArrowPressed() when user swipes left
document.addEventListener('swiped-left', function (e) {
  leftArrowPressed();
});
// call rightArrowPressed() when user clicks
document.addEventListener('click', function (e) {
  // except when clicking on a link
  if (e.target.tagName === 'A') {
    return;
  }
  rightArrowPressed();
});

// Show first slide
show(activeSlide);
// showWebGL(); activeSlide = slideCount + 1; slideChangedAt = time;
