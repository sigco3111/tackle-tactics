import math, os
from PIL import Image, ImageDraw
from gen_v1 import (S,OUT,SKIN,HAIR,SHIRT,SHORT,SOCK,BOOT,hexc,dark,R,Canvas,seg,rect,ell)
import gen2
from gen2 import ik, pol
KSHIRT=[hexc(x) for x in ('e86aa8','b04878','ff94c8')]
KSHORT=[hexc(x) for x in ('2a2a34','1a1a22','45454f')]
KSOCK=[hexc(x) for x in ('2a2a34','1a1a22','45454f')]
GLOVE=[hexc(x) for x in ('f0f0f0','b8bcc8','ffffff')]
def head(c,hc,head_type,tilt=0):
    cx,cy=hc
    c.part(ell(cx-8,cy-8,cx+8,cy+8),SKIN)
    if head_type=='side':
        def hair(d,col,o):
            d.pieslice([cx-9,cy-9,cx+8,cy+8],150,390,fill=col); d.rectangle([cx-9,cy-3,cx-3,cy+3],fill=col); d.ellipse([cx-9,cy-6,cx-1,cy+6],fill=col)
        c.part(hair,HAIR); c.part(rect(cx+3,cy-1,cx+4,cy+2,0),[OUT]*3,shade=False)
    elif head_type=='back':
        c.part(lambda d,col,o: d.ellipse([cx-10,cy-9,cx+10,cy+8],fill=col),HAIR)
    else:
        def hair(d,col,o):
            d.pieslice([cx-10,cy-9,cx+10,cy+8],180,360,fill=col); d.rectangle([cx-10,cy-2,cx-8,cy+1],fill=col); d.rectangle([cx+8,cy-2,cx+10,cy+1],fill=col); d.rectangle([cx-8,cy-4,cx+8,cy-2],fill=col)
        c.part(hair,HAIR)
        c.part(rect(cx-4,cy+1,cx-3,cy+3,0),[OUT]*3,shade=False); c.part(rect(cx+3,cy+1,cx+4,cy+3,0),[OUT]*3,shade=False)
def free(hip,ang,legs,arms,kit,head_type='side',flip=False,kneedir=(1,1),glove=False):
    shirt,short,sock=kit
    c=Canvas(); d=(math.sin(math.radians(ang)),-math.cos(math.radians(ang)))
    sh=(hip[0]+d[0]*11,hip[1]+d[1]*11); hc=(sh[0]+d[0]*7,sh[1]+d[1]*7)
    def arm(a,far):
        th,bend=a; k=1.5 if (glove and ang>60) else 1.0; e=pol(th,6.5*k); el=(sh[0]+e[0],sh[1]+e[1]); h=pol(th+bend,5.5*k); hand=(el[0]+h[0],el[1]+h[1])
        c.part(seg(sh,el,4),shirt,far); c.part(seg(el,hand,3),SKIN,far)
        c.part(ell(hand[0]-2,hand[1]-2,hand[0]+2,hand[1]+2),GLOVE if glove else SKIN,far,shade=False)
    def leg(foot,far,kd):
        knee=ik(hip,(foot[0],foot[1]-2),7.5,7.5,kd)
        c.part(seg(hip,knee,5),SKIN,far); c.part(seg(knee,(foot[0],foot[1]-2),4),sock,far)
        c.part(rect(foot[0]-3,foot[1]-2,foot[0]+4,foot[1]+1,1),BOOT,far)
    arm(arms[1],True); leg(legs[1],True,kneedir[1])
    c.part(seg(hip,sh,9),shirt); c.part(ell(hip[0]-5,hip[1]-4,hip[0]+5,hip[1]+4),short)
    leg(legs[0],False,kneedir[0])
    head(c,hc,head_type)
    arm(arms[0],False)
    img=c.render()
    return img.transpose(Image.FLIP_LEFT_RIGHT) if flip else img
SLIDE=[ # hip, ang, legs(near,far), arms(near,far)
 ((32,44),-8,((37,58),(27,58)),((-40,60),(40,60))),
 ((31,47),-28,((40,58),(25,57)),((-60,50),(30,60))),
 ((29,51),-50,((43,57),(24,58)),((-80,30),(10,60))),
 ((28,54),-68,((47,57),(33,58)),((-85,20),(60,30))),
 ((27,54),-70,((48,57),(33,58)),((-85,20),(70,30))),
 ((27,54),-70,((48,57),(32,58)),((-85,20),(70,30))),
 ((28,54),-65,((47,57),(32,58)),((-85,20),(60,30))),
 ((29,51),-40,((40,58),(25,58)),((-60,40),(30,50))),
 ((31,47),-18,((38,58),(26,58)),((-30,50),(30,50))),
 ((32,44),-4,((35,58),(29,58)),((-10,20),(10,20))),
]
DIVE=[
 ((32,47),12,((38,58),(26,58)),((60,30),(50,30))),
 ((32,49),22,((39,58),(25,58)),((70,25),(60,25))),
 ((30,46),50,((24,56),(21,54)),((110,10),(100,10))),
 ((30,42),70,((20,50),(17,47)),((100,5),(95,5))),
 ((28,38),84,((14,41),(11,38)),((95,5),(90,5))),
 ((28,38),86,((13,40),(10,37)),((95,5),(90,5))),
 ((28,41),86,((13,44),(10,41)),((95,5),(90,5))),
 ((28,50),84,((13,54),(10,52)),((92,5),(88,5))),
 ((26,55),88,((11,58),(8,57)),((95,5),(90,5))),
 ((30,50),40,((26,58),(22,57)),((60,20),(50,20))),
]
def slide_side(i,flip=False):
    h,a,l,ar=SLIDE[i]; return free(h,a,l,ar,(SHIRT,SHORT,SOCK),'side',flip,kneedir=(1,1))
def dive_side(i,flip=False,ht='side'):
    h,a,l,ar=DIVE[i]; return free(h,a,l,ar,(KSHIRT,KSHORT,KSOCK),ht,flip,kneedir=(-1,-1),glove=True)
def slide_front(i,back=False):
    # facing viewer: body drops low, near leg thrusts toward camera (big boot), arms out for balance
    drop=[0,2,5,8,9,9,8,5,2,0][i]; ext=[0,1,3,6,7,7,6,3,1,0][i]
    c=Canvas(); hipy=45+drop; top=32+drop
    def armf(sd,h): 
        x=26 if sd<0 else 38; sh=(x,34+drop); hand=(x+sd*(4+h),sh[1]+6-h*0.4)
        el=((sh[0]+hand[0])/2,(sh[1]+hand[1])/2+1)
        c.part(seg(sh,el,4),SHIRT); c.part(seg(el,hand,3),SKIN); c.part(ell(hand[0]-1.5,hand[1]-1.5,hand[0]+1.5,hand[1]+1.5),SKIN,shade=False)
    # far leg bent: foot near hip
    fx,fy=(29,min(58,hipy+6)); 
    c.part(seg((29,hipy),(27,hipy+5),5),SKIN); c.part(seg((27,hipy+5),(fx-1,min(58,hipy+9)),4),SOCK)
    c.part(rect(fx-4,min(58,hipy+9)-1,fx+2,min(58,hipy+9)+2,1),BOOT)
    c.part(rect(26,top,38,hipy,3),SHIRT); c.part(rect(26,hipy-4,38,hipy+3,1),SHORT)
    armf(-1,ext*0.8); armf(1,ext*0.8)
    # near leg thrust toward camera: boot grows
    foot=(37,min(59,hipy+8+ext)); big=1+ext//4
    c.part(seg((35,hipy),(36,(hipy+foot[1])/2),5),SKIN); c.part(seg((36,(hipy+foot[1])/2),(foot[0],foot[1]-2),4),SOCK)
    c.part(rect(foot[0]-3-big,foot[1]-2-big,foot[0]+3+big,foot[1]+1,1),BOOT)
    hy=22+drop
    gen_head(c,(32,hy),'back' if back else 'front')
    return c.render()
def gen_head(c,hc,t): head(c,hc,t)
def slide(d,i):
    return {'right':lambda:slide_side(i),'left':lambda:slide_side(i,True),'down':lambda:slide_front(i),'up':lambda:slide_front(i,True)}[d]()
def dive(d,i):
    return {'right':lambda:dive_side(i),'left':lambda:dive_side(i,True),'down':lambda:dive_side(i,False,'front'),'up':lambda:dive_side(i,False,'back')}[d]()
if __name__=='__main__':
    base='/downloads/sample/blue_v2'; kb='/downloads/sample/keeper_pink_v2'
    os.makedirs(kb,exist_ok=True)
    for d in ['down','up','left','right']:
        for name,fn,n,b in [('slide_tackle',slide,10,base),('gk_dive',dive,10,kb)]:
            st=Image.new('RGBA',(S*n,S),(0,0,0,0))
            for i in range(n): st.paste(fn(d,i),(i*S,0))
            st.save(f'{b}/{name}_{d}.png')
    G=(70,150,70,255)
    for name,fn in [('slide',slide),('dive',dive)]:
        z=Image.new('RGBA',(10*128,128*4),G)
        for k,d in enumerate(['right','left','down','up']):
            for i in range(10): z.alpha_composite(fn(d,i).resize((128,128),Image.NEAREST),(i*128,k*128))
        z.save(f'/downloads/sample/v3_{name}_sheet.png')
    print('ok')
